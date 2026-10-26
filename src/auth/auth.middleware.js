
import jwt from "jsonwebtoken";
import { query } from "../config/database.js";

export async function authenticateToken(req, res, next) {
  const authorization = req.headers.authorization;

  if (!authorization?.startsWith("Bearer ")) {
    return res.status(401).json({
      message: "Authentication required",
    });
  }

  const token = authorization.slice(7).trim();

  if (!token) {
    return res.status(401).json({
      message: "Authentication required",
    });
  }

  let payload;

  try {
    payload = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ["HS256"],
    });
  } catch (error) {
    if (
      error.name === "JsonWebTokenError" ||
      error.name === "TokenExpiredError" ||
      error.name === "NotBeforeError"
    ) {
      return res.status(401).json({
        message: "Invalid or expired token",
      });
    }

    throw error;
  }

  if (typeof payload.sub !== "string") {
    return res.status(401).json({
      message: "Invalid token",
    });
  }

  const users = await query(
    "SELECT id, is_admin FROM users WHERE id = ? LIMIT 1",
    [payload.sub]
  );

  if (!users.length) {
    return res.status(401).json({
      message: "User account no longer exists",
    });
  }

  req.user = {
    id: users[0].id,
    is_admin:
      users[0].is_admin === true ||
      users[0].is_admin === 1 ||
      users[0].is_admin === "1",
  };

  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user?.is_admin) {
    return res.status(403).json({
      message: "Administrator access required",
    });
  }

  next();
}
