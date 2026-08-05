-- Discount system migration for existing Katered Kneads databases.
-- Run once in the Supabase SQL Editor. Safe to re-run (IF NOT EXISTS guards).

-- ── Sale prices on menu items ───────────────────────────────────────────────
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS sale_price NUMERIC(10, 2);
DO $$
BEGIN
    ALTER TABLE menu_items ADD CONSTRAINT menu_items_sale_price_check
        CHECK (sale_price IS NULL OR (sale_price > 0 AND sale_price < price));
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- ── Order discount fields ─────────────────────────────────────────────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_cents INT NOT NULL DEFAULT 0;
DO $$
BEGIN
    ALTER TABLE orders ADD CONSTRAINT orders_discount_cents_check CHECK (discount_cents >= 0);
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_code TEXT;

-- ── In-person sale discount fields ────────────────────────────────────────
ALTER TABLE in_person_sales ADD COLUMN IF NOT EXISTS discount_cents INT NOT NULL DEFAULT 0;
DO $$
BEGIN
    ALTER TABLE in_person_sales ADD CONSTRAINT in_person_sales_discount_cents_check CHECK (discount_cents >= 0);
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
ALTER TABLE in_person_sales ADD COLUMN IF NOT EXISTS coupon_code TEXT;

-- ── Coupons table ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coupons
(
    id                 UUID PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
    code               TEXT             NOT NULL,
    type               TEXT             NOT NULL CHECK (type IN ('percent', 'fixed')),
    value              INT              NOT NULL CHECK (value > 0),
    active             BOOLEAN          NOT NULL DEFAULT true,
    expires_at         TIMESTAMPTZ,
    max_redemptions    INT              CHECK (max_redemptions IS NULL OR max_redemptions > 0),
    redemption_count   INT              NOT NULL DEFAULT 0 CHECK (redemption_count >= 0),
    min_subtotal_cents INT              CHECK (min_subtotal_cents IS NULL OR min_subtotal_cents >= 0),
    created_at         TIMESTAMPTZ      NOT NULL DEFAULT now(),
    UNIQUE (code),
    CHECK (
        (type = 'percent' AND value <= 100)
        OR (type = 'fixed')
    )
);

CREATE INDEX IF NOT EXISTS coupons_code_idx ON coupons (code);

ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON coupons FROM anon, authenticated;

-- ── Atomic redemption bump ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION increment_coupon_redemption(p_coupon_id UUID)
    RETURNS VOID AS
$$
DECLARE
    v_updated INT;
BEGIN
    UPDATE coupons
    SET redemption_count = redemption_count + 1
    WHERE id = p_coupon_id
      AND active = true
      AND (expires_at IS NULL OR expires_at > now())
      AND (max_redemptions IS NULL OR redemption_count < max_redemptions);

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN
        RAISE EXCEPTION 'Coupon % cannot be redeemed (inactive, expired, or at max uses)', p_coupon_id;
    END IF;
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION increment_coupon_redemption(UUID) FROM anon, authenticated;

-- Reload PostgREST schema cache so the new table is visible immediately.
NOTIFY pgrst, 'reload schema';
