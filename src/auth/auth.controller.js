
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

import {
  sendVerificationEmail,
} from "../email/resend.js";

const ACCESS_TOKEN_EXPIRY =
  process.env.JWT_EXPIRES_IN || "15m";

const REFRESH_TOKEN_DAYS = 7;
const VERIFICATION_TOKEN_MINUTES = 30;

// --------------------------------------------------
// Helpers
// --------------------------------------------------

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function isVerified(value) {
  return (
    value === true ||
    value === 1 ||
    value === "1"
  );
}

function createAccessToken(userId) {
  return jwt.sign(
    {},
    process.env.JWT_SECRET,
    {
      subject: userId,
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
    Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
}

function serializeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    is_admin: isVerified(user.is_admin),
    is_email_verified: isVerified(user.is_email_verified),
    created_at: user.created_at,
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

async function createSession(userId) {
  const refreshToken = createRefreshToken();
  const tokenHash = hashToken(refreshToken);

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
    accessToken: createAccessToken(userId),
    refreshToken,
  };
}

// --------------------------------------------------
// Email verification helpers
// --------------------------------------------------

async function issueVerificationEmail(user) {
  // Generate a secure, single-use token.
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);

  const expiresAt = new Date(
    Date.now() + VERIFICATION_TOKEN_MINUTES * 60 * 1000
  ).toISOString();

  // Invalidate previous outstanding verification tokens.
  await query(
    `UPDATE email_verification_tokens
     SET used_at = CURRENT_TIMESTAMP
     WHERE user_id = ?
       AND used_at IS NULL`,
    [user.id]
  );

  // Store only the hash, never the raw token.
  await query(
    `INSERT INTO email_verification_tokens
      (id, user_id, token_hash, expires_at)
     VALUES (?, ?, ?, ?)`,
    [
      randomUUID(),
      user.id,
      tokenHash,
      expiresAt,
    ]
  );

  // Send the raw token only through the verification email.
  await sendVerificationEmail({
    email: user.email,
    name: user.name,
    token,
  });
}

// --------------------------------------------------
// POST /api/auth/register
// --------------------------------------------------

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

  let user;

  try {
    const created = await query(
      `INSERT INTO users
        (id, name, email, password_hash, is_admin)
       VALUES (?, ?, ?, ?, FALSE)
       RETURNING id, name, email, is_admin,
                 is_email_verified, created_at`,
      [id, cleanName, cleanEmail, passwordHash]
    );

    user = created[0];
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

  // Account exists, but no session is issued until verification.
  try {
    await issueVerificationEmail(user);
  } catch (error) {
    console.error(
      "Verification email delivery failed:",
      error.message
    );

    return res.status(503).json({
      message:
        "Your account was created, but the verification email could not be sent. Please request another email.",
      email: user.email,
      emailVerificationRequired: true,
    });
  }

  return res.status(201).json({
    message:
      "Account created. Please verify your email before logging in.",
    email: user.email,
    emailVerificationRequired: true,
  });
}

// --------------------------------------------------
// POST /api/auth/verify-email
// --------------------------------------------------

export async function verifyEmail(req, res) {
  const { token } = req.body ?? {};

  if (
    typeof token !== "string" ||
    token.length < 20 ||
    token.length > 200
  ) {
    return res.status(400).json({
      message: "A valid verification token is required.",
    });
  }

  const tokenHash = hashToken(token);

  const outcome = await withTransaction(async (txQuery) => {
    const records = await txQuery(
      `SELECT id, user_id, expires_at, used_at
       FROM email_verification_tokens
       WHERE token_hash = ?
       LIMIT 1`,
      [tokenHash]
    );

    const record = records[0];

    if (!record || record.used_at) {
      return { error: "invalid" };
    }

    if (Date.parse(record.expires_at) <= Date.now()) {
      await txQuery(
        `UPDATE email_verification_tokens
         SET used_at = CURRENT_TIMESTAMP
         WHERE id = ? AND used_at IS NULL`,
        [record.id]
      );

      return { error: "expired" };
    }

    // Consume the token once only.
    const consumed = await txQuery(
      `UPDATE email_verification_tokens
       SET used_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND used_at IS NULL
       RETURNING id`,
      [record.id]
    );

    if (consumed.length === 0) {
      return { error: "invalid" };
    }

    await txQuery(
      `UPDATE users
       SET is_email_verified = TRUE,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [record.user_id]
    );

    return { success: true };
  });

  if (outcome.error) {
    return res.status(400).json({
      message:
        outcome.error === "expired"
          ? "This verification link has expired. Please request another."
          : "This verification link is invalid or has already been used.",
    });
  }

  return res.json({
    message:
      "Email verified successfully. You can now log in.",
  });
}

// --------------------------------------------------
// POST /api/auth/resend-verification
// --------------------------------------------------

export async function resendVerification(req, res) {
  const { email } = req.body ?? {};

  if (
    typeof email !== "string" ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  ) {
    return res.status(400).json({
      message: "Enter a valid email address.",
    });
  }

  const users = await query(
    `SELECT id, name, email, is_email_verified
     FROM users
     WHERE email = ?
     LIMIT 1`,
    [email.trim().toLowerCase()]
  );

  const user = users[0];

  // Use the same response whether or not the account exists.
  if (user && !isVerified(user.is_email_verified)) {
    try {
      await issueVerificationEmail(user);
    } catch (error) {
      console.error(
        "Resend verification failed:",
        error.message
      );
    }
  }

  return res.json({
    message:
      "If an unverified account exists for this email, a verification email will be sent.",
  });
}

// --------------------------------------------------
// POST /api/auth/login
// --------------------------------------------------

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
            is_admin, is_email_verified, created_at
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

  if (!isVerified(user.is_email_verified)) {
    return res.status(403).json({
      message: "Please verify your email before logging in.",
      emailVerificationRequired: true,
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

// --------------------------------------------------
// GET /api/auth/me
// --------------------------------------------------

export async function me(req, res) {
  const users = await query(
    `SELECT id, name, email, is_admin,
            is_email_verified, created_at
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

// --------------------------------------------------
// POST /api/auth/refresh
// --------------------------------------------------

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

  const tokenHash = hashToken(refreshToken);

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

    // Reuse of an old token revokes its whole family.
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
      `SELECT id, name, email, is_admin,
              is_email_verified, created_at
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

    const user = users[0];

    // Do not issue new tokens for an unverified account.
    if (!isVerified(user.is_email_verified)) {
      await txQuery(
        `UPDATE refresh_tokens
         SET revoked_at =
           COALESCE(revoked_at, CURRENT_TIMESTAMP)
         WHERE family_id = ?`,
        [stored.family_id]
      );

      return { error: "unverified" };
    }

    const nextRefreshToken = createRefreshToken();
    const nextHash = hashToken(nextRefreshToken);

    // RETURNING id lets us check whether the token was rotated.
    const updated = await txQuery(
      `UPDATE refresh_tokens
       SET revoked_at = CURRENT_TIMESTAMP,
           replaced_by_hash = ?
       WHERE id = ?
         AND revoked_at IS NULL
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
      user,
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
      accessToken: createAccessToken(outcome.user.id),
      refreshToken: outcome.refreshToken,
    },
    200,
    "Token refreshed successfully"
  );
}

// --------------------------------------------------
// POST /api/auth/logout
// --------------------------------------------------

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
      [hashToken(refreshToken)]
    );
  }

  return res.json({
    message: "Logged out successfully",
  });
}
