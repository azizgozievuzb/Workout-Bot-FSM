-- ============================================================
-- Migration 024: Extended onboarding (fitness / age / goal)
-- Apply in Supabase SQL Editor
-- ============================================================

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS fitness_level TEXT
        CHECK (fitness_level IN ('beginner','intermediate','advanced')),
    ADD COLUMN IF NOT EXISTS age_range TEXT
        CHECK (age_range IN ('<18','18-25','26-35','36-45','46-55','55+')),
    ADD COLUMN IF NOT EXISTS goal TEXT
        CHECK (goal IN ('lose_weight','build_muscle','endurance','health','flexibility')),
    ADD COLUMN IF NOT EXISTS active_days_count INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS goal_update_required BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS goal_last_updated_at TIMESTAMPTZ;

-- Helpful index for Job H lookups (players with active partnership)
CREATE INDEX IF NOT EXISTS idx_users_role_goal ON users(role) WHERE role = 'player';
