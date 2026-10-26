
import jwt from "jsonwebtoken";
import { WebSocketServer, WebSocket } from "ws";
import { query } from "../config/database.js";

const MAX_AUTH_MESSAGE_BYTES = 8 * 1024;
const clientsByUserId = new Map();

let webSocketServer;

function sendJson(socket, payload) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function isVerified(value) {
  return value === true || value === 1 || value === "1";
}

async function getAuthenticatedUser(token) {
  if (typeof token !== "string" || !token) {
    throw new Error("Authentication token is required.");
  }

  let payload;

  try {
    payload = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ["HS256"],
    });
  } catch {
    throw new Error("Invalid or expired access token.");
  }

  if (typeof payload.sub !== "string") {
    throw new Error("Invalid access token.");
  }

  const users = await query(
    `SELECT id, name, is_email_verified
     FROM users
     WHERE id = ?
     LIMIT 1`,
    [payload.sub],
  );

  const user = users[0];

  if (!user) {
    throw new Error("User account no longer exists.");
  }

  if (!isVerified(user.is_email_verified)) {
    throw new Error("Please verify your email before using chat.");
  }

  return {
    id: user.id,
    name: user.name,
  };
}

function addClient(userId, socket) {
  const sockets = clientsByUserId.get(userId) ?? new Set();

  sockets.add(socket);
  clientsByUserId.set(userId, sockets);
}

function removeClient(userId, socket) {
  if (!userId) return;

  const sockets = clientsByUserId.get(userId);

  if (!sockets) return;

  sockets.delete(socket);

  if (sockets.size === 0) {
    clientsByUserId.delete(userId);
  }
}

export function broadcastToUsers(userIds, payload) {
  const serialized = JSON.stringify(payload);

  for (const userId of new Set(userIds.filter(Boolean))) {
    const sockets = clientsByUserId.get(userId);

    if (!sockets) continue;

    for (const socket of sockets) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(serialized);
      }
    }
  }
}

export function attachChatWebSocket(server) {
  if (webSocketServer) return webSocketServer;

  webSocketServer = new WebSocketServer({
    server,
    path: "/api/chat/ws",
    maxPayload: MAX_AUTH_MESSAGE_BYTES,
  });

  webSocketServer.on("connection", (socket) => {
    let userId = null;
    let authenticated = false;

    const authTimeout = setTimeout(() => {
      if (!authenticated) {
        sendJson(socket, {
          type: "error",
          message: "Authentication timeout.",
        });

        socket.close(1008, "Authentication required");
      }
    }, 10_000);

    socket.on("message", async (raw) => {
      try {
        const event = JSON.parse(raw.toString());

        // The first message must authenticate the connection.
        if (!authenticated) {
          if (event?.type !== "auth") {
            socket.close(1008, "Authenticate first");
            return;
          }

          const user = await getAuthenticatedUser(event.token);

          userId = user.id;
          authenticated = true;

          clearTimeout(authTimeout);
          addClient(userId, socket);

          sendJson(socket, {
            type: "ready",
            user: {
              id: user.id,
              name: user.name,
            },
          });

          return;
        }

        if (event?.type === "ping") {
          sendJson(socket, {
            type: "pong",
            at: new Date().toISOString(),
          });
        }
      } catch (error) {
        sendJson(socket, {
          type: "error",
          message: error.message || "Invalid WebSocket message.",
        });

        if (!authenticated) {
          socket.close(1008, "Authentication failed");
        }
      }
    });

    socket.on("close", () => {
      clearTimeout(authTimeout);
      removeClient(userId, socket);
    });

    socket.on("error", (error) => {
      console.warn("Chat WebSocket error:", error.message);

      clearTimeout(authTimeout);
      removeClient(userId, socket);
    });
  });

  return webSocketServer;
}
