-- migrate:up

CREATE TABLE IF NOT EXISTS listings (
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

CREATE INDEX IF NOT EXISTS idx_listings_user_id
ON listings(user_id);

CREATE INDEX IF NOT EXISTS idx_listings_status_created_at
ON listings(status, created_at);

CREATE INDEX IF NOT EXISTS idx_listings_category
ON listings(category);

CREATE INDEX IF NOT EXISTS idx_listings_city
ON listings(city);


CREATE TABLE IF NOT EXISTS listing_images (
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

CREATE INDEX IF NOT EXISTS idx_listing_images_listing_id
ON listing_images(listing_id);


-- migrate:down

DROP TABLE IF EXISTS listing_images;
DROP TABLE IF EXISTS listings;