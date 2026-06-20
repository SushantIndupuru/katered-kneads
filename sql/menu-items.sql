CREATE
    EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS menu_items
(
    id          UUID PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
    name        TEXT             NOT NULL,
    description TEXT             NOT NULL DEFAULT '',
    price       NUMERIC(10, 2)   NOT NULL DEFAULT 0.00
);

CREATE TABLE IF NOT EXISTS config
(
    name  TEXT PRIMARY KEY NOT NULL,
    value TEXT
);

CREATE TABLE IF NOT EXISTS drops
(
    id             UUID PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
    name           TEXT             NOT NULL,
    open_time      TIMESTAMPTZ      NOT NULL,
    close_time     TIMESTAMPTZ      NOT NULL,
    -- When true, this drop's countdown teaser is shown on the site before it opens.
    show_countdown BOOLEAN          NOT NULL DEFAULT false,
    CHECK (close_time > open_time)
);

CREATE TABLE IF NOT EXISTS drop_items
(
    drop_id        UUID NOT NULL,
    menu_item_id   UUID NOT NULL,
    initial_stock  INT  NOT NULL CHECK (initial_stock >= 0),
    consumed_stock INT  NOT NULL DEFAULT 0,
    -- When true, this item is shown in the drop's pre-open preview (sneak peek).
    preview        BOOLEAN NOT NULL DEFAULT false,
    -- Optional marketing tag shown on the item card (e.g. "Fan Favorite").
    tag            TEXT    NOT NULL DEFAULT '',
    CHECK (consumed_stock >= 0),
    CHECK (consumed_stock <= initial_stock),
    PRIMARY KEY (drop_id, menu_item_id),
    FOREIGN KEY (drop_id) REFERENCES drops (id) ON DELETE CASCADE,
    FOREIGN KEY (menu_item_id) REFERENCES menu_items (id) ON DELETE CASCADE
);