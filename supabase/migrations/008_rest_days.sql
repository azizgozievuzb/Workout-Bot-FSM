-- ============================================================
-- Migration 008: Rest days for female players (3/month)
-- ============================================================

ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS rest_days_remaining INTEGER DEFAULT 3;
ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS rest_days_used_this_month INTEGER DEFAULT 0;

-- Note: APScheduler job resets these on 1st of each month:
-- UPDATE player_stats SET rest_days_remaining = 3, rest_days_used_this_month = 0
-- WHERE player_id IN (SELECT id FROM users WHERE gender = 'female');
