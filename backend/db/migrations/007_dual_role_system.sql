-- ============================================================
-- Migration 007: Dual role system
-- Replaces single `role` with primary_role + access flags
-- ============================================================

-- 1. Add new columns
ALTER TABLE users ADD COLUMN IF NOT EXISTS primary_role VARCHAR(20) CHECK (primary_role IN ('player', 'responsible'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS has_player_access BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS has_responsible_access BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;

-- 2. Migrate data from old `role` column
UPDATE users SET primary_role = 'player',      has_player_access = TRUE,  has_responsible_access = FALSE WHERE role = 'player';
UPDATE users SET primary_role = 'responsible',  has_player_access = FALSE, has_responsible_access = TRUE  WHERE role = 'responsible';
UPDATE users SET primary_role = 'responsible',  has_player_access = FALSE, has_responsible_access = TRUE, is_admin = TRUE WHERE role = 'admin';

-- 3. Add constraint: responsible cannot be their own player
-- (enforced at app level via partnerships.responsible_id ≠ player_id)

-- 4. Keep old `role` column for now (backward compat), drop later
-- ALTER TABLE users DROP COLUMN role;
