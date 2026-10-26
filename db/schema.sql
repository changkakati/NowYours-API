CREATE TABLE IF NOT EXISTS "schema_migrations" (version varchar(128) primary key);
CREATE TABLE users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
, is_email_verified BOOLEAN NOT NULL DEFAULT FALSE, google_sub TEXT);
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
CREATE TABLE password_reset_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_password_reset_tokens_user_id
ON password_reset_tokens(user_id);
CREATE UNIQUE INDEX idx_users_google_sub
ON users(google_sub);
CREATE TABLE listings (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    title TEXT NOT NULL
        CHECK (length(title) BETWEEN 3 AND 120),

    description TEXT NOT NULL
        CHECK (length(description) BETWEEN 10 AND 5000),

    listing_type TEXT NOT NULL
        CHECK (listing_type IN ('sell', 'exchange', 'free')),

    category TEXT NOT NULL,

    item_condition TEXT NOT NULL
        CHECK (item_condition IN ('new', 'like_new', 'good', 'fair')),

    price INTEGER,
    desired_exchange TEXT,

    city TEXT NOT NULL,
    area TEXT,

    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'sold', 'given_away', 'archived')),

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CHECK (
        (listing_type = 'sell' AND price IS NOT NULL AND price >= 0)
        OR
        (listing_type = 'exchange' AND (price IS NULL OR price >= 0))
        OR
        (listing_type = 'free' AND price IS NULL)
    )
);
CREATE INDEX idx_listings_user_id
ON listings(user_id);
CREATE INDEX idx_listings_status_created_at
ON listings(status, created_at);
CREATE INDEX idx_listings_category
ON listings(category);
CREATE INDEX idx_listings_city
ON listings(city);
CREATE TABLE listing_images (
    id TEXT PRIMARY KEY,

    listing_id TEXT NOT NULL
        REFERENCES listings(id) ON DELETE CASCADE,

    image_url TEXT NOT NULL,
    pathname TEXT NOT NULL,

    position INTEGER NOT NULL DEFAULT 0
        CHECK (position BETWEEN 0 AND 3),

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE (listing_id, position)
);
CREATE INDEX idx_listing_images_listing_id
ON listing_images(listing_id);
CREATE TABLE conversations (
    id TEXT PRIMARY KEY,
    listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    buyer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    seller_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (buyer_id <> seller_id),
    UNIQUE (listing_id, buyer_id, seller_id)
);
CREATE INDEX idx_conversations_buyer_updated
ON conversations(buyer_id, updated_at);
CREATE INDEX idx_conversations_seller_updated
ON conversations(seller_id, updated_at);
CREATE TABLE chat_messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL
        REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 5000),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    read_at TEXT
);
CREATE INDEX idx_chat_messages_conversation_created
ON chat_messages(conversation_id, created_at);
CREATE INDEX idx_chat_messages_unread
ON chat_messages(conversation_id, sender_id, read_at);
CREATE TABLE notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    link TEXT,
    conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
    read_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_notifications_user_created
ON notifications(user_id, created_at);
CREATE INDEX idx_notifications_user_unread
ON notifications(user_id, read_at);
CREATE TABLE wishlists (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, listing_id)
);
CREATE INDEX idx_wishlists_user_created
ON wishlists(user_id, created_at);
-- Dbmate schema migrations
INSERT INTO "schema_migrations" (version) VALUES
  ('20261026063250'),
  ('20261026071607'),
  ('20261026075615'),
  ('20261026081852'),
  ('20261026084327'),
  ('20261026115335'),
  ('20261026141510'),
  ('20261026143522'),
  ('20261026145212');
