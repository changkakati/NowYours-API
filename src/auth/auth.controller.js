
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import {
  randomBytes,
  randomUUID,
  createHash,
} from "node:crypto";

import {
  query,
  withTransaction,
} from "../config/database.js";

const ACCESS_TOKEN_EXPIRY =
  process.env.JWT_EXPIRES_IN || "15m";

const REFRESH_TOKEN_DAYS = 7;

function hashRefreshToken(token) {
  return createHash("sha256")
    .update(token)
    .digest("hex");
}

function createAccessToken(user) {
  return jwt.sign(
    {},
    process.env.JWT_SECRET,
    {
      subject: user.id,
      expiresIn: ACCESS_TOKEN_EXPIRY,
      algorithm: "HS256",
    }
  );
}

function createRefreshToken() {
  return randomBytes(32).toString("base64url");
}

function refreshExpiry() {
  return new Date(
    Date.now() +
      REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
}

function serializeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    is_admin:
      user.is_admin === true ||
      user.is_admin === 1 ||
      user.is_admin === "1",
    created_at: user.created_at,
  };
}

async function createSession(userId) {
  const refreshToken = createRefreshToken();
  const tokenHash = hashRefreshToken(refreshToken);

  await query(
    `INSERT INTO refresh_tokens
      (id, user_id, family_id, token_hash, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      userId,
      randomUUID(),
      tokenHash,
      refreshExpiry(),
    ]
  );

  return {
    accessToken: createAccessToken({ id: userId }),
    refreshToken,
  };
}

function sendSession(
  res,
  user,
  tokens,
  status = 200,
  message = "Success"
) {
  return res.status(status).json({
    message,
    user: serializeUser(user),
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    tokenType: "Bearer",
    expiresIn: ACCESS_TOKEN_EXPIRY,
    refreshExpiresIn: `${REFRESH_TOKEN_DAYS}d`,
  });
}

// POST /api/auth/register
export async function register(req, res) {
  const { name, email, password } = req.body ?? {};

  if (
    typeof name !== "string" ||
    typeof email !== "string" ||
    typeof password !== "string"
  ) {
    return res.status(400).json({
      message: "Name, email and password are required",
    });
  }

  const cleanName = name.trim();
  const cleanEmail = email.trim().toLowerCase();

  if (!cleanName || cleanName.length > 100) {
    return res.status(400).json({
      message: "Name must be between 1 and 100 characters",
    });
  }

  if (
    cleanEmail.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)
  ) {
    return res.status(400).json({
      message: "Enter a valid email address",
    });
  }

  if (
    password.length < 8 ||
    Buffer.byteLength(password, "utf8") > 72
  ) {
    return res.status(400).json({
      message:
        "Password must be at least 8 characters and at most 72 UTF-8 bytes",
    });
  }

  const existing = await query(
    "SELECT id FROM users WHERE email = ? LIMIT 1",
    [cleanEmail]
  );

  if (existing.length > 0) {
    return res.status(409).json({
      message: "An account with this email already exists",
    });
  }

  const id = randomUUID();
  const passwordHash = await bcrypt.hash(password, 12);

  try {
    const created = await query(
      `INSERT INTO users
        (id, name, email, password_hash, is_admin)
       VALUES (?, ?, ?, ?, FALSE)
       RETURNING id, name, email, is_admin, created_at`,
      [id, cleanName, cleanEmail, passwordHash]
    );

    const user = created[0];
    const tokens = await createSession(user.id);

    return sendSession(
      res,
      user,
      tokens,
      201,
      "Account created successfully"
    );
  } catch (error) {
    if (
      error.code === "SQLITE_CONSTRAINT_UNIQUE" ||
      error.code === "SQLITE_CONSTRAINT_PRIMARYKEY" ||
      error.code === "23505"
    ) {
      return res.status(409).json({
        message: "An account with this email already exists",
      });
    }

    throw error;
  }
}

// POST /api/auth/login
export async function login(req, res) {
  const { email, password } = req.body ?? {};

  if (
    typeof email !== "string" ||
    typeof password !== "string"
  ) {
    return res.status(400).json({
      message: "Email and password are required",
    });
  }

  const users = await query(
    `SELECT id, name, email, password_hash,
            is_admin, created_at
     FROM users
     WHERE email = ?
     LIMIT 1`,
    [email.trim().toLowerCase()]
  );

  const user = users[0];

  if (
    !user ||
    !(await bcrypt.compare(password, user.password_hash))
  ) {
    return res.status(401).json({
      message: "Invalid email or password",
    });
  }

  const tokens = await createSession(user.id);

  return sendSession(
    res,
    user,
    tokens,
    200,
    "Login successful"
  );
}

// GET /api/auth/me
export async function me(req, res) {
  const users = await query(
    `SELECT id, name, email, is_admin, created_at
     FROM users
     WHERE id = ?
     LIMIT 1`,
    [req.user.id]
  );

  if (users.length === 0) {
    return res.status(401).json({
      message: "User account no longer exists",
    });
  }

  return res.json({
    user: serializeUser(users[0]),
  });
}

// POST /api/auth/refresh
export async function refresh(req, res) {
  const { refreshToken } = req.body ?? {};

  if (
    typeof refreshToken !== "string" ||
    refreshToken.length > 200
  ) {
    return res.status(401).json({
      message: "Valid refresh token required",
    });
  }

  const tokenHash = hashRefreshToken(refreshToken);

  const outcome = await withTransaction(async (txQuery) => {
    const tokens = await txQuery(
      `SELECT id, user_id, family_id, token_hash,
              expires_at, revoked_at
       FROM refresh_tokens
       WHERE token_hash = ?
       LIMIT 1`,
      [tokenHash]
    );

    const stored = tokens[0];

    if (!stored) {
      return { error: "invalid" };
    }

    // Reuse of a rotated token revokes its whole family.
    if (stored.revoked_at) {
      await txQuery(
        `UPDATE refresh_tokens
         SET revoked_at =
           COALESCE(revoked_at, CURRENT_TIMESTAMP)
         WHERE family_id = ?`,
        [stored.family_id]
      );

      return { error: "reuse" };
    }

    if (Date.parse(stored.expires_at) <= Date.now()) {
      await txQuery(
        `UPDATE refresh_tokens
         SET revoked_at = CURRENT_TIMESTAMP
         WHERE id = ? AND revoked_at IS NULL`,
        [stored.id]
      );

      return { error: "expired" };
    }

    const users = await txQuery(
      `SELECT id, name, email, is_admin, created_at
       FROM users
       WHERE id = ?
       LIMIT 1`,
      [stored.user_id]
    );

    if (users.length === 0) {
      await txQuery(
        `UPDATE refresh_tokens
         SET revoked_at = CURRENT_TIMESTAMP
         WHERE family_id = ?`,
        [stored.family_id]
      );

      return { error: "invalid" };
    }

    const nextRefreshToken = createRefreshToken();
    const nextHash = hashRefreshToken(nextRefreshToken);

    // RETURNING id is essential: our query helper returns rows,
    // not the number of rows changed by an UPDATE.
    const updated = await txQuery(
      `UPDATE refresh_tokens
       SET revoked_at = CURRENT_TIMESTAMP,
           replaced_by_hash = ?
       WHERE id = ? AND revoked_at IS NULL
       RETURNING id`,
      [nextHash, stored.id]
    );

    if (updated.length === 0) {
      return { error: "invalid" };
    }

    await txQuery(
      `INSERT INTO refresh_tokens
        (id, user_id, family_id, token_hash, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        stored.user_id,
        stored.family_id,
        nextHash,
        refreshExpiry(),
      ]
    );

    return {
      user: users[0],
      refreshToken: nextRefreshToken,
    };
  });

  if (outcome.error) {
    return res.status(401).json({
      message:
        "Refresh token is invalid, expired, or revoked. Please log in again.",
    });
  }

  return sendSession(
    res,
    outcome.user,
    {
      accessToken: createAccessToken({
        id: outcome.user.id,
      }),
      refreshToken: outcome.refreshToken,
    },
    200,
    "Token refreshed successfully"
  );
}

// POST /api/auth/logout
export async function logout(req, res) {
  const { refreshToken } = req.body ?? {};

  if (
    typeof refreshToken === "string" &&
    refreshToken.length <= 200
  ) {
    await query(
      `UPDATE refresh_tokens
       SET revoked_at = CURRENT_TIMESTAMP
       WHERE token_hash = ?
         AND revoked_at IS NULL`,
      [hashRefreshToken(refreshToken)]
    );
  }

  return res.json({
    message: "Logged out successfully",
  });
}
