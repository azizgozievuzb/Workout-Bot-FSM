-- ============================================================
-- Migration 018: Drop NOT NULL constraint on partnerships.pairing_code
-- Supabase SQL Editor
-- ============================================================

ALTER TABLE partnerships
  ALTER COLUMN pairing_code DROP NOT NULL;
