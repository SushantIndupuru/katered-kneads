-- Katered Kneads — main database setup.
-- Run this once against a fresh Supabase/Postgres database to create the full
-- schema (tables + stock functions). Safe to re-run: every statement uses
-- IF NOT EXISTS / CREATE OR REPLACE. Commented ALTER blocks below each table are
-- one-off migrations for databases created before a column was added.

CREATE
    EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS menu_items
(
    id          UUID PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
    name        TEXT             NOT NULL,
    description TEXT             NOT NULL DEFAULT '',
    price       NUMERIC(10, 2)   NOT NULL DEFAULT 0.00
);

-- The active/focused drop is not stored as a pointer; it is derived from the
-- columns below. Active drop = the single row with archived_at IS NULL; it
-- becomes the public/current drop once announced_at is set.
CREATE TABLE IF NOT EXISTS drops
(
    id             UUID PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
    name           TEXT             NOT NULL,
    open_time      TIMESTAMPTZ      NOT NULL,
    close_time     TIMESTAMPTZ      NOT NULL,
    -- When the actual pickup/drop happens. Independent of close_time (ordering
    -- can close well before pickup day). NULL = not scheduled yet.
    pickup_time    TIMESTAMPTZ,
    -- Public, general pickup area shown before payment (e.g. "Downtown Davis").
    -- Kept vague on purpose so the exact spot isn't exposed to non-buyers.
    location_name    TEXT           NOT NULL DEFAULT '',
    -- Exact pickup address. Sensitive (could be a private residence): only ever
    -- revealed to a customer AFTER their payment is confirmed.
    location_address TEXT           NOT NULL DEFAULT '',
    -- NULL = private draft; set = announced (public countdown + previews show).
    announced_at   TIMESTAMPTZ,
    -- NULL = the single active/focused drop; set = moved to the "older drops" list.
    archived_at    TIMESTAMPTZ,
    -- When an item's remaining online stock is at or below this number, the
    -- storefront shows a "Low stock, N left" badge. 0 = never show remaining
    -- counts (the default): items just read as available until they sell out.
    low_stock_threshold INT NOT NULL DEFAULT 0 CHECK (low_stock_threshold >= 0),
    CHECK (close_time > open_time)
);

-- Migration for existing databases: add the per-drop location + pickup columns.
-- ALTER TABLE drops ADD COLUMN IF NOT EXISTS pickup_time      TIMESTAMPTZ;
-- ALTER TABLE drops ADD COLUMN IF NOT EXISTS location_name    TEXT NOT NULL DEFAULT '';
-- ALTER TABLE drops ADD COLUMN IF NOT EXISTS location_address TEXT NOT NULL DEFAULT '';
-- Migration: add the per-drop low-stock threshold.
-- ALTER TABLE drops ADD COLUMN IF NOT EXISTS low_stock_threshold INT NOT NULL DEFAULT 0;
-- ALTER TABLE drops ADD CONSTRAINT drops_low_stock_threshold_check CHECK (low_stock_threshold >= 0);

CREATE TABLE IF NOT EXISTS drop_items
(
    drop_id        UUID NOT NULL,
    menu_item_id   UUID NOT NULL,
    -- Online pool: stock sold through the website and consumed by paid orders.
    initial_stock  INT  NOT NULL CHECK (initial_stock >= 0),
    consumed_stock INT  NOT NULL DEFAULT 0,
    -- In-person pool: a separate allocation sold in person, tracked independently
    -- of the online pool (never touched by online ordering).
    in_person_stock    INT NOT NULL DEFAULT 0 CHECK (in_person_stock >= 0),
    in_person_consumed INT NOT NULL DEFAULT 0,
    -- Production tracker: how many of this item have physically been baked/made
    -- so far, against the target (initial_stock + in_person_stock). Independent
    -- of what's been sold — it just tracks the kitchen's progress.
    made_stock     INT NOT NULL DEFAULT 0 CHECK (made_stock >= 0),
    -- When true, this item is shown in the drop's pre-open preview (sneak peek).
    preview        BOOLEAN NOT NULL DEFAULT false,
    -- Optional marketing tag shown on the item card (e.g. "Fan Favorite").
    tag            TEXT    NOT NULL DEFAULT '',
    CHECK (consumed_stock >= 0),
    CHECK (consumed_stock <= initial_stock),
    CHECK (in_person_consumed >= 0),
    CHECK (in_person_consumed <= in_person_stock),
    PRIMARY KEY (drop_id, menu_item_id),
    FOREIGN KEY (drop_id) REFERENCES drops (id) ON DELETE CASCADE,
    FOREIGN KEY (menu_item_id) REFERENCES menu_items (id) ON DELETE CASCADE
);

-- Migration for existing databases: add the in-person pool columns.
-- ALTER TABLE drop_items ADD COLUMN IF NOT EXISTS in_person_stock    INT NOT NULL DEFAULT 0;
-- ALTER TABLE drop_items ADD COLUMN IF NOT EXISTS in_person_consumed INT NOT NULL DEFAULT 0;
-- ALTER TABLE drop_items ADD CONSTRAINT drop_items_in_person_stock_check    CHECK (in_person_stock >= 0);
-- ALTER TABLE drop_items ADD CONSTRAINT drop_items_in_person_consumed_check CHECK (in_person_consumed >= 0);
-- ALTER TABLE drop_items ADD CONSTRAINT drop_items_in_person_max_check      CHECK (in_person_consumed <= in_person_stock);

-- Migration for existing databases: add the production tracker column.
-- ALTER TABLE drop_items ADD COLUMN IF NOT EXISTS made_stock INT NOT NULL DEFAULT 0;
-- ALTER TABLE drop_items ADD CONSTRAINT drop_items_made_stock_check CHECK (made_stock >= 0);

CREATE TABLE IF NOT EXISTS orders
(
    id                       UUID PRIMARY KEY      NOT NULL DEFAULT gen_random_uuid(),
    drop_id                  UUID,
    -- paid | fulfilled (orders are only persisted once payment is confirmed).
    status                   TEXT                  NOT NULL DEFAULT 'paid',
    customer_name            TEXT                  NOT NULL,
    customer_email           TEXT                  NOT NULL,
    customer_phone           TEXT                  NOT NULL DEFAULT '',
    -- Snapshot of the drop's scheduled pickup date/time at purchase time.
    pickup_time              TIMESTAMPTZ,
    -- Snapshot of the drop's general pickup area at purchase time.
    pickup_location          TEXT                  NOT NULL DEFAULT '',
    -- Snapshot of the exact pickup address at purchase time. Captured only on a
    -- confirmed (paid) order, so it is safe to show the customer their address.
    pickup_address           TEXT                  NOT NULL DEFAULT '',
    subtotal_cents           INT                   NOT NULL CHECK (subtotal_cents >= 0),
    -- Optional gratuity added by the customer at checkout. Stored separately from
    -- subtotal_cents; the amount charged is subtotal_cents + tip_cents.
    tip_cents                INT                   NOT NULL DEFAULT 0 CHECK (tip_cents >= 0),
    -- Short code the customer brings to pickup; set once payment is confirmed.
    pickup_code                 TEXT UNIQUE,
    -- The Checkout Session is the natural key (created up front); the
    -- PaymentIntent id is captured on confirmation for refunds/reconciliation.
    stripe_checkout_session_id  TEXT UNIQUE,
    stripe_payment_intent_id    TEXT UNIQUE,
    created_at                  TIMESTAMPTZ           NOT NULL DEFAULT now(),
    FOREIGN KEY (drop_id) REFERENCES drops (id) ON DELETE SET NULL
);

-- Migration for existing databases: replace the old `campus` field with the
-- per-drop pickup snapshot columns.
-- ALTER TABLE orders RENAME COLUMN campus TO pickup_location;
-- ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_address TEXT NOT NULL DEFAULT '';
-- ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_time    TIMESTAMPTZ;
-- Migration: add optional customer gratuity.
-- ALTER TABLE orders ADD COLUMN IF NOT EXISTS tip_cents INT NOT NULL DEFAULT 0;
-- ALTER TABLE orders ADD CONSTRAINT orders_tip_cents_check CHECK (tip_cents >= 0);

CREATE TABLE IF NOT EXISTS order_items
(
    -- Surrogate key: menu_item_id cannot be part of the PK because deleting a
    -- menu item sets it to NULL (the row survives as a historical snapshot), and
    -- a NULL can neither sit in a PK nor be NOT NULL.
    id               UUID NOT NULL DEFAULT gen_random_uuid(),
    order_id         UUID NOT NULL,
    menu_item_id     UUID,
    -- Snapshot of the item name/price at purchase time (survives menu edits/deletes).
    name_snapshot    TEXT NOT NULL,
    unit_price_cents INT  NOT NULL CHECK (unit_price_cents >= 0),
    quantity         INT  NOT NULL CHECK (quantity > 0),
    PRIMARY KEY (id),
    FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE,
    FOREIGN KEY (menu_item_id) REFERENCES menu_items (id) ON DELETE SET NULL
);

-- Migration for existing databases: the original PRIMARY KEY (order_id,
-- menu_item_id) made menu_item_id implicitly NOT NULL, so ON DELETE SET NULL
-- failed when deleting a menu item still referenced by an order. Swap to a
-- surrogate id PK and make menu_item_id nullable.
-- ALTER TABLE order_items ADD COLUMN IF NOT EXISTS id UUID NOT NULL DEFAULT gen_random_uuid();
-- ALTER TABLE order_items DROP CONSTRAINT order_items_pkey;
-- ALTER TABLE order_items ADD PRIMARY KEY (id);
-- ALTER TABLE order_items ALTER COLUMN menu_item_id DROP NOT NULL;

-- In-person POS sales paid via Stripe QR (Payment Element on a page we host, so
-- no email/phone is collected). Unlike online orders these draw from the
-- in-person pool (drop_items.in_person_consumed) and carry no customer details.
-- The PaymentIntent id is UNIQUE so recording a paid sale is idempotent (the
-- webhook + POS poll can both fire safely).
CREATE TABLE IF NOT EXISTS in_person_sales
(
    id                       UUID PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
    drop_id                  UUID,
    subtotal_cents           INT              NOT NULL CHECK (subtotal_cents >= 0),
    -- Optional gratuity the customer added on the pay page; the amount charged is
    -- subtotal_cents + tip_cents.
    tip_cents                INT              NOT NULL DEFAULT 0 CHECK (tip_cents >= 0),
    stripe_payment_intent_id TEXT UNIQUE      NOT NULL,
    -- Snapshot of the sold cart as a JSON array of
    -- { "menuItemId": uuid, "nameSnapshot": text, "unitPriceCents": int, "quantity": int }.
    items                    JSONB            NOT NULL DEFAULT '[]'::jsonb,
    created_at               TIMESTAMPTZ      NOT NULL DEFAULT now(),
    FOREIGN KEY (drop_id) REFERENCES drops (id) ON DELETE SET NULL
);

-- Migration for existing databases: add the in-person gratuity column.
-- ALTER TABLE in_person_sales ADD COLUMN IF NOT EXISTS tip_cents INT NOT NULL DEFAULT 0;
-- ALTER TABLE in_person_sales ADD CONSTRAINT in_person_sales_tip_cents_check CHECK (tip_cents >= 0);

-- Customers who opted in to SMS drop updates (announce / open / close / pickup).
-- The actual sending is wired up later; this table just captures consented
-- numbers now. Phone is stored in E.164 (e.g. +15305551234) and is UNIQUE so
-- re-signups are idempotent (they re-activate rather than duplicate).
CREATE TABLE IF NOT EXISTS sms_subscribers
(
    id              UUID PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
    phone           TEXT UNIQUE      NOT NULL,
    -- Explicit consent captured at signup (kept for TCPA compliance records).
    consent         BOOLEAN          NOT NULL DEFAULT true,
    -- Where the signup happened (e.g. "footer", "order"), for light analytics.
    source          TEXT             NOT NULL DEFAULT '',
    -- NULL = actively subscribed; set = opted out (kept as a suppression list
    -- so a future STOP handler never texts them again).
    unsubscribed_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ      NOT NULL DEFAULT now()
);

-- ── Row Level Security ──────────────────────────────────────────────────────
-- CRITICAL: the site ships a public "publishable"/anon Supabase key to the
-- browser (PUBLIC_SUPABASE_PUBLISHABLE_KEY). Tables created via raw SQL do NOT
-- have RLS enabled by default, which would let anyone use that public key to
-- read/write every table directly through Supabase's REST API — bypassing the
-- app entirely.
--
-- We enable RLS on every table and define NO policies for the anon/authenticated
-- roles, which makes those roles default-deny (no read, no write). The server-
-- side code uses the SECRET (service_role) key, which BYPASSES RLS, so the app's
-- own API routes keep working. Net effect: the only way to touch the DB is
-- through our server, and those routes are gated by admin auth in middleware.
ALTER TABLE menu_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE drops           ENABLE ROW LEVEL SECURITY;
ALTER TABLE drop_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders          ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE in_person_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_subscribers ENABLE ROW LEVEL SECURITY;

-- Belt-and-suspenders: explicitly revoke all table privileges from the public
-- API roles. RLS already blocks them, but revoking grants means even a future
-- accidental policy can't hand them access unless privileges are re-granted too.
REVOKE ALL ON menu_items, drops, drop_items, orders, order_items, in_person_sales, sms_subscribers
    FROM anon, authenticated;

-- Atomically record an in-person sale by incrementing in_person_consumed for
-- each line. `items` is a JSON array of { "menuItemId": uuid, "quantity": int }.
-- Raises if any line would exceed the in-person allocation so the caller fails
-- loudly (the QR payment can then be refunded by the owner).
CREATE OR REPLACE FUNCTION increment_in_person_consumed(p_drop_id UUID, items JSONB)
    RETURNS VOID AS
$$
DECLARE
    line      JSONB;
    v_menu_id UUID;
    v_qty     INT;
    v_updated INT;
BEGIN
    FOR line IN SELECT * FROM jsonb_array_elements(items)
        LOOP
            v_menu_id := (line ->> 'menuItemId')::UUID;
            v_qty := (line ->> 'quantity')::INT;

            UPDATE drop_items
            SET in_person_consumed = in_person_consumed + v_qty
            WHERE drop_id = p_drop_id
              AND menu_item_id = v_menu_id
              AND in_person_consumed + v_qty <= in_person_stock;

            GET DIAGNOSTICS v_updated = ROW_COUNT;
            IF v_updated = 0 THEN
                RAISE EXCEPTION 'Insufficient in-person stock for menu item % in drop %', v_menu_id, p_drop_id;
            END IF;
        END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Atomically decrement stock for a confirmed order. `items` is a JSON array of
-- { "menuItemId": uuid, "quantity": int }. Raises if any line would oversell so
-- the webhook fails loudly (the payment can then be refunded by the owner).
CREATE OR REPLACE FUNCTION decrement_drop_stock(p_drop_id UUID, items JSONB)
    RETURNS VOID AS
$$
DECLARE
    line          JSONB;
    v_menu_id     UUID;
    v_qty         INT;
    v_updated     INT;
BEGIN
    FOR line IN SELECT * FROM jsonb_array_elements(items)
        LOOP
            v_menu_id := (line ->> 'menuItemId')::UUID;
            v_qty := (line ->> 'quantity')::INT;

            UPDATE drop_items
            SET consumed_stock = consumed_stock + v_qty
            WHERE drop_id = p_drop_id
              AND menu_item_id = v_menu_id
              AND consumed_stock + v_qty <= initial_stock;

            GET DIAGNOSTICS v_updated = ROW_COUNT;
            IF v_updated = 0 THEN
                RAISE EXCEPTION 'Insufficient stock for menu item % in drop %', v_menu_id, p_drop_id;
            END IF;
        END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Inverse of decrement_drop_stock: returns stock to a drop when a paid order is
-- deleted. `items` is the same JSON array shape. Clamped at 0 so it can never
-- drive consumed_stock negative (respects the consumed_stock >= 0 CHECK).
CREATE OR REPLACE FUNCTION restock_drop_items(p_drop_id UUID, items JSONB)
    RETURNS VOID AS
$$
DECLARE
    line      JSONB;
    v_menu_id UUID;
    v_qty     INT;
BEGIN
    FOR line IN SELECT * FROM jsonb_array_elements(items)
        LOOP
            v_menu_id := (line ->> 'menuItemId')::UUID;
            v_qty := (line ->> 'quantity')::INT;

            UPDATE drop_items
            SET consumed_stock = GREATEST(consumed_stock - v_qty, 0)
            WHERE drop_id = p_drop_id
              AND menu_item_id = v_menu_id;
        END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Inverse of increment_in_person_consumed: returns in-person stock to a drop
-- when a recorded POS sale is deleted. `items` is the same JSON array shape.
-- Clamped at 0 so it can never drive in_person_consumed negative (respects the
-- in_person_consumed >= 0 CHECK). Note: this only reverses the stock count — it
-- does NOT refund the customer's payment.
CREATE OR REPLACE FUNCTION decrement_in_person_consumed(p_drop_id UUID, items JSONB)
    RETURNS VOID AS
$$
DECLARE
    line      JSONB;
    v_menu_id UUID;
    v_qty     INT;
BEGIN
    FOR line IN SELECT * FROM jsonb_array_elements(items)
        LOOP
            v_menu_id := (line ->> 'menuItemId')::UUID;
            v_qty := (line ->> 'quantity')::INT;

            UPDATE drop_items
            SET in_person_consumed = GREATEST(in_person_consumed - v_qty, 0)
            WHERE drop_id = p_drop_id
              AND menu_item_id = v_menu_id;
        END LOOP;
END;
$$ LANGUAGE plpgsql;

-- These stock functions mutate the DB and are only ever invoked server-side via
-- the service_role key. Postgres grants EXECUTE to PUBLIC by default, so revoke
-- it from the public API roles to keep them from being called with the anon key.
REVOKE EXECUTE ON FUNCTION
    increment_in_person_consumed(UUID, JSONB),
    decrement_drop_stock(UUID, JSONB),
    restock_drop_items(UUID, JSONB),
    decrement_in_person_consumed(UUID, JSONB)
    FROM anon, authenticated;
