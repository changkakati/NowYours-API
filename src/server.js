
import "dotenv/config";
import { createServer } from "node:http";

import app from "./app.js";
import { closeDatabase } from "./config/database.js";
import { attachChatWebSocket } from "./chat/chat.realtime.js";

if (
  !process.env.JWT_SECRET ||
  Buffer.byteLength(process.env.JWT_SECRET) < 32
) {
  throw new Error(
    "JWT_SECRET must contain at least 32 bytes",
  );
}

const port = Number(process.env.PORT) || 3001;

const server = createServer(app);

attachChatWebSocket(server);

server.listen(port, () => {
  console.log(`API running at http://localhost:${port}`);
  console.log(
    `Chat WebSocket at ws://localhost:${port}/api/chat/ws`,
  );
});

function shutdown() {
  server.close(async () => {
    try {
      await closeDatabase();
    } finally {
      process.exit(0);
    }
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
