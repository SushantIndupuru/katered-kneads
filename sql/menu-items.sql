CREATE
    EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS menu_items
(
    id          UUID PRIMARY KEY        DEFAULT gen_random_uuid(),
    mystery     BOOLEAN        NOT NULL DEFAULT FALSE,
    name        TEXT           NOT NULL,
    description TEXT           NOT NULL DEFAULT '',
    price       NUMERIC(10, 2) NOT NULL DEFAULT 0.00
);

CREATE TABLE IF NOT EXISTS best_sellers
(
    id         UUID PRIMARY KEY,
    tag        TEXT NOT NULL DEFAULT '',
    sort_order INT  NOT NULL UNIQUE,
    FOREIGN KEY (id) REFERENCES menu_items (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS new_items
(
    id         UUID PRIMARY KEY,
    tag        TEXT NOT NULL DEFAULT '',
    sort_order INT  NOT NULL UNIQUE,
    FOREIGN KEY (id) REFERENCES menu_items (id) ON DELETE CASCADE
);