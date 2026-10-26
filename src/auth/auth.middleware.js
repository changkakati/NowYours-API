
import jwt from "jsonwebtoken";
import { query } from "../config/database.js";

// --------------------------------------------------
// Authenticate user using JWT access token
// --------------------------------------------------

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

    return next(error);
  }

  // Make sure the JWT contains a valid user ID.
  if (typeof payload.sub !== "string") {
    return res.status(401).json({
      message: "Invalid token",
    });
  }

  // Fetch the current user from the database.
  const users = await query(
    `SELECT id, is_admin, is_email_verified
     FROM users
     WHERE id = ?
     LIMIT 1`,
    [payload.sub]
  );

  if (!users.length) {
    return res.status(401).json({
      message: "User account no longer exists",
    });
  }

  const user = users[0];

  // Normalize SQLite boolean values.
  const isEmailVerified =
    user.is_email_verified === true ||
    user.is_email_verified === 1 ||
    user.is_email_verified === "1";

  const isAdmin =
    user.is_admin === true ||
    user.is_admin === 1 ||
    user.is_admin === "1";

  // Block access until the email is verified.
  if (!isEmailVerified) {
    return res.status(403).json({
      message: "Please verify your email before accessing this resource.",
      emailVerificationRequired: true,
    });
  }

  // Attach authenticated user to the request.
  req.user = {
    id: user.id,
    is_admin: isAdmin,
    is_email_verified: isEmailVerified,
  };

  return next();
}

// --------------------------------------------------
// Restrict routes to administrators
// --------------------------------------------------

export function requireAdmin(req, res, next) {
  if (!req.user?.is_admin) {
    return res.status(403).json({
      message: "Administrator access required",
    });
  }

  return next();
}
