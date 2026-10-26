-- migrate:up

ALTER TABLE users
ADD COLUMN is_email_verified BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE email_verification_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_email_verification_tokens_user_id
ON email_verification_tokens(user_id);


-- migrate:down

DROP TABLE email_verification_tokens;

ALTER TABLE users
DROP COLUMN is_email_verified;