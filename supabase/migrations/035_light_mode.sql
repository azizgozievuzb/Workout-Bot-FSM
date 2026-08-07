-- Migration 035: Phase 8b — light mode (idempotent)

ALTER TABLE users ADD COLUMN IF NOT EXISTS light_unlocked BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS light_active_from DATE NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS light_locked_at TIMESTAMPTZ NULL;

ALTER TABLE workout_sessions ADD COLUMN IF NOT EXISTS session_type TEXT NOT NULL DEFAULT 'main';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workout_sessions_session_type_check') THEN
    ALTER TABLE workout_sessions
      ADD CONSTRAINT workout_sessions_session_type_check
      CHECK (session_type IN ('main', 'light'));
  END IF;
END$$;

ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS last_main_drops_day DATE NULL;
ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS last_light_drops_day DATE NULL;

CREATE TABLE IF NOT EXISTS app_shop_items (
    key         TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    price_drops INT  NOT NULL CHECK (price_drops >= 1),
    is_active   BOOLEAN NOT NULL DEFAULT true,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO app_shop_items (key, title, price_drops, is_active) VALUES
    ('light_unlock', 'Открыть light-режим', 300, true),
    ('light_lock',   'Закрыть light-режим', 500, true)
ON CONFLICT (key) DO NOTHING;