
-- migrate:up

ALTER TABLE users
ADD COLUMN google_sub TEXT;

CREATE UNIQUE INDEX idx_users_google_sub
ON users(google_sub);


-- migrate:down

DROP INDEX idx_users_google_sub;

ALTER TABLE users
DROP COLUMN google_sub;
