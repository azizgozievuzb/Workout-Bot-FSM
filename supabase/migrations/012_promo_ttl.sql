-- ============================================================
-- Migration 012: Promo TTL lifecycle — archive, auto-expire, cascade delete
-- Run in Supabase SQL Editor
-- ============================================================

-- 1. promo_codes: TTL columns
ALTER TABLE promo_codes
  ADD COLUMN IF NOT EXISTS duration_days INT NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS activated_by BIGINT REFERENCES users(telegram_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS warn_sent TIMESTAMPTZ;

-- duration_days constraint (add only if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'promo_duration_check'
  ) THEN
    ALTER TABLE promo_codes
      ADD CONSTRAINT promo_duration_check CHECK (duration_days IN (7, 30, 90));
  END IF;
END $$;

-- expires_at already added in migration 010; this migration repurposes it
-- for player TTL (activated_at + duration_days). No schema change needed.

-- 2. Archive table for expired promo codes
CREATE TABLE IF NOT EXISTS promo_codes_archive (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_id UUID,
  code TEXT NOT NULL,
  code_type TEXT,
  duration_days INT,
  created_at TIMESTAMPTZ,
  created_by BIGINT,
  activated_at TIMESTAMPTZ,
  activated_by BIGINT,
  partnership_id UUID,
  responsible_id BIGINT,
  player_id BIGINT,
  expired_at TIMESTAMPTZ NOT NULL,
  archived_at TIMESTAMPTZ DEFAULT now()
);

-- 3. users: deactivation tracking
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS scheduled_deletion_at TIMESTAMPTZ;

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_promo_codes_expires_at ON promo_codes(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_promo_codes_warn_sent ON promo_codes(warn_sent) WHERE warn_sent IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_deactivated_at ON users(deactivated_at) WHERE deactivated_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_scheduled_deletion ON users(scheduled_deletion_at) WHERE scheduled_deletion_at IS NOT NULL;
