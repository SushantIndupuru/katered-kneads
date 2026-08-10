-- Catering quote requests (run once against an existing database).
-- Safe to re-run: IF NOT EXISTS / ENABLE RLS / REVOKE are idempotent.

CREATE TABLE IF NOT EXISTS catering_requests
(
    id                          UUID PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
    status                      TEXT             NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'paid', 'rejected')),
    customer_name               TEXT             NOT NULL,
    customer_email              TEXT             NOT NULL,
    customer_phone              TEXT             NOT NULL DEFAULT '',
    event_date                  TEXT             NOT NULL DEFAULT '',
    notes                       TEXT             NOT NULL DEFAULT '',
    subtotal_cents              INT              NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
    admin_note                  TEXT             NOT NULL DEFAULT '',
    stripe_checkout_session_id  TEXT UNIQUE,
    stripe_payment_intent_id    TEXT UNIQUE,
    approved_at                 TIMESTAMPTZ,
    paid_at                     TIMESTAMPTZ,
    created_at                  TIMESTAMPTZ      NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS catering_request_items
(
    id               UUID PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
    request_id       UUID             NOT NULL,
    menu_item_id     UUID,
    name_snapshot    TEXT             NOT NULL,
    unit_price_cents INT              NOT NULL CHECK (unit_price_cents >= 0),
    quantity         INT              NOT NULL CHECK (quantity > 0),
    FOREIGN KEY (request_id) REFERENCES catering_requests (id) ON DELETE CASCADE,
    FOREIGN KEY (menu_item_id) REFERENCES menu_items (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS catering_request_items_request_id_idx ON catering_request_items (request_id);
CREATE INDEX IF NOT EXISTS catering_requests_status_idx ON catering_requests (status);
CREATE INDEX IF NOT EXISTS catering_requests_created_at_idx ON catering_requests (created_at DESC);

ALTER TABLE catering_requests      ENABLE ROW LEVEL SECURITY;
ALTER TABLE catering_request_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON catering_requests, catering_request_items FROM anon, authenticated;
