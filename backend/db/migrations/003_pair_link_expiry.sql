-- ============================================================
-- Migration 003: Pair link expiry (7 days)
-- Run in Supabase SQL Editor
-- ============================================================

-- 1. Add expires_at column
ALTER TABLE partnerships ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- 2. Backfill existing rows
UPDATE partnerships SET expires_at = created_at + INTERVAL '7 days' WHERE expires_at IS NULL;

-- 3. Allow 'expired' status in check constraint
ALTER TABLE partnerships DROP CONSTRAINT IF EXISTS partnerships_status_check;
ALTER TABLE partnerships ADD CONSTRAINT partnerships_status_check
    CHECK (status IN ('pending', 'active', 'blocked', 'expired'));
