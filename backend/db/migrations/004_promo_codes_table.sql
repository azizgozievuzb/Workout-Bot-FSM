-- ============================================================
-- Migration 004: Promo codes table + brute force protection
-- Run in Supabase SQL Editor
-- ============================================================

-- 1. Promo codes table (one-time use, admin-created)
CREATE TABLE IF NOT EXISTS promo_codes (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code        VARCHAR(128) UNIQUE NOT NULL,
    tier        VARCHAR(20) CHECK (tier IN ('basic', 'premium')) NOT NULL DEFAULT 'basic',
    is_used     BOOLEAN DEFAULT FALSE,
    used_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_promo_codes_code ON promo_codes(code);
CREATE INDEX IF NOT EXISTS idx_promo_codes_used_by ON promo_codes(used_by);

-- RLS
ALTER TABLE promo_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON promo_codes TO service_role USING (true) WITH CHECK (true);

-- 2. Brute force tracking: failed promo attempts per user
ALTER TABLE users ADD COLUMN IF NOT EXISTS promo_attempts INT DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS promo_locked_until TIMESTAMPTZ;

-- 3. Store which promo_code was used during onboarding (to burn it on link generation)
ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_promo_id UUID REFERENCES promo_codes(id);
