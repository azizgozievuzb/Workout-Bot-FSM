-- Migration 034: Phase 8a foundation (idempotent)
ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone TEXT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS detected_timezone TEXT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS main_days SMALLINT[] NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_main_days SMALLINT[] NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_schedule_from DATE NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS schedule_changed_at TIMESTAMPTZ NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS schedule_grace_until TIMESTAMPTZ NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS morning_reminder_time TIME NOT NULL DEFAULT '08:00';
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_morning_reminder_date DATE NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_evening_reminder_date DATE NULL;

ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS free_freezes_left SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS paid_freezes SMALLINT NOT NULL DEFAULT 0;

UPDATE player_stats
   SET free_freezes_left = LEAST(GREATEST(COALESCE(rest_days_remaining, 0), 0), 3)
 WHERE free_freezes_left = 0 AND COALESCE(rest_days_remaining, 0) > 0;
UPDATE player_stats
   SET paid_freezes = LEAST(GREATEST(COALESCE(streak_freeze_balance, 0), 0), 3)
 WHERE paid_freezes = 0 AND COALESCE(streak_freeze_balance, 0) > 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'player_stats_paid_freezes_cap') THEN
    ALTER TABLE player_stats
      ADD CONSTRAINT player_stats_paid_freezes_cap
      CHECK (paid_freezes >= 0 AND paid_freezes <= 3);
  END IF;
END$$;

ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS last_closed_day DATE NULL;
ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS last_streak_eval_day DATE NULL;