-- ============================================================
-- Migration 013: Enforce code_type NOT NULL + fix existing NULLs
-- Run in Supabase SQL Editor
-- ============================================================

-- 1. Fix any existing rows where code_type is NULL
--    Rows with responsible_id set → player code; otherwise → responsible
UPDATE promo_codes
SET code_type = CASE
    WHEN responsible_id IS NOT NULL THEN 'player'
    ELSE 'responsible'
END
WHERE code_type IS NULL;

-- 2. Add NOT NULL constraint
ALTER TABLE promo_codes ALTER COLUMN code_type SET NOT NULL;

-- 3. Ensure default stays 'responsible' for admin-created codes
ALTER TABLE promo_codes ALTER COLUMN code_type SET DEFAULT 'responsible';
