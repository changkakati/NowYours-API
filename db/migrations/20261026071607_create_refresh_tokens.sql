
-- migrate:up

CREATE TABLE refresh_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    family_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    replaced_by_hash TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_refresh_tokens_user_id
ON refresh_tokens(user_id);

CREATE INDEX idx_refresh_tokens_family_id
ON refresh_tokens(family_id);

-- migrate:down

DROP TABLE refresh_tokens;
