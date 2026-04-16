-- ============================================================
-- Migration 005: Add 'upgrade' tier to promo_codes
-- Run in Supabase SQL Editor
-- ============================================================

ALTER TABLE promo_codes DROP CONSTRAINT IF EXISTS promo_codes_tier_check;
ALTER TABLE promo_codes ADD CONSTRAINT promo_codes_tier_check
    CHECK (tier IN ('basic', 'premium', 'upgrade'));
