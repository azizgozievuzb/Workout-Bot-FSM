-- ============================================================
-- Migration 010: Promo codes v2 — types, links, responsible binding
-- Run in Supabase SQL Editor
-- ============================================================

-- 1. Code type (responsible / player / admin)
ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS code_type VARCHAR(20)
    CHECK (code_type IN ('responsible', 'player', 'admin')) DEFAULT 'responsible';

-- 2. Parent code reference (player_code → responsible_code)
ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS parent_code_id UUID
    REFERENCES promo_codes(id) ON DELETE SET NULL;

-- 3. Responsible owner (player_code knows its responsible)
ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS responsible_id UUID
    REFERENCES users(id) ON DELETE SET NULL;

-- 4. Deep link support
ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS deep_link_token VARCHAR(64) UNIQUE;
ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- 5. Indexes
CREATE INDEX IF NOT EXISTS idx_promo_codes_code_type ON promo_codes(code_type);
CREATE INDEX IF NOT EXISTS idx_promo_codes_responsible_id ON promo_codes(responsible_id);
CREATE INDEX IF NOT EXISTS idx_promo_codes_deep_link_token ON promo_codes(deep_link_token);
