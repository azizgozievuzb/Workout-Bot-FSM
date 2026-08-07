-- Part A — schema (idempotent)
CREATE TABLE IF NOT EXISTS tier_prices (
  tier              VARCHAR PRIMARY KEY CHECK (tier IN ('standard','premium','elite')),
  intro_price_stars INT NOT NULL CHECK (intro_price_stars >= 1),
  price_1m          INT NOT NULL CHECK (price_1m >= 1),
  price_3m          INT NOT NULL CHECK (price_3m >= 1),
  price_12m         INT NOT NULL CHECK (price_12m >= 1),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO tier_prices (tier, intro_price_stars, price_1m, price_3m, price_12m) VALUES
  ('standard', 750, 5000, 13500, 48000),
  ('premium',  750, 5000, 13500, 48000),
  ('elite',    750, 5000, 13500, 48000)
ON CONFLICT (tier) DO NOTHING;

CREATE TABLE IF NOT EXISTS coupons (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code         VARCHAR UNIQUE NOT NULL,
  discount_pct INT NOT NULL CHECK (discount_pct BETWEEN 1 AND 99),
  is_active    BOOLEAN NOT NULL DEFAULT true,
  max_uses     INT NULL,
  used_count   INT NOT NULL DEFAULT 0,
  expires_at   TIMESTAMPTZ NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE payments ADD COLUMN IF NOT EXISTS tier         VARCHAR NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS period       VARCHAR NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS coupon_id    UUID NULL REFERENCES coupons(id) ON DELETE SET NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS discount_pct INT NULL;

DO $$ BEGIN
  ALTER TABLE payments ADD CONSTRAINT payments_period_check
    CHECK (period IS NULL OR period IN ('intro','1m','3m','12m'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_product_type_fkey;

ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_expires_at  TIMESTAMPTZ NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pricing_mode             VARCHAR NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_price_stars       INT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_renewal_reminder_at TIMESTAMPTZ NULL;

DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_pricing_mode_check
    CHECK (pricing_mode IS NULL OR pricing_mode IN ('free','custom'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS invites (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code           VARCHAR(16) UNIQUE NOT NULL,
  responsible_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  used_by        UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  used_at        TIMESTAMPTZ NULL,
  expires_at     TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invites_responsible ON invites(responsible_id);
CREATE INDEX IF NOT EXISTS idx_invites_code ON invites(code);