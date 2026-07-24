-- ============================================================
-- Migration 036: Phase 8c — магазин игрока
--   * app_shop_items: meta JSONB + seed витрины (freeze, photo_card,
--     photo_reroll, schedule_change, streak_restore). Цены — плейсхолдеры,
--     редактируются существующим админ-редактором app-shop-items.
--   * users: фото-карточка (card_photo_url/source/candidates).
--   * player_stats: lost_streak_len/at (restore стрика; пишет closure-джоб).
--   * workout_sessions: completed_full (done == плановому числу упражнений;
--     день закрывает ТОЛЬКО полная сессия).
-- Idempotent (safe to re-run).
-- ============================================================

-- ---------- app_shop_items: meta + seed 8c ----------
-- meta — параметры карточки (для streak_restore: {min, cap} зажим цены).
ALTER TABLE app_shop_items ADD COLUMN IF NOT EXISTS meta JSONB NULL;

INSERT INTO app_shop_items (key, title, price_drops, is_active, meta) VALUES
    ('freeze',          'Заморозка стрика',        50, true, NULL),
    ('photo_card',      'Своё фото на карточке',  200, true, NULL),
    ('photo_reroll',    'Ещё 2 варианта фото',     60, true, NULL),
    ('schedule_change', 'Смена графика',          100, true, NULL),
    -- цена за 1 день сгоревшего стрика; итог зажимается в [meta.min, meta.cap]
    ('streak_restore',  'Восстановить стрик',      20, true, '{"min": 60, "cap": 400}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ---------- users: фото-карточка (8.8b) ----------
-- card_photo_url        — фото, которое видит наставник (NULL → мультяшка по полу).
-- card_photo_source     — 'ai' (обработано photo_styler-стеком) | 'raw' (как есть).
-- card_photo_candidates — 2 сгенерированных варианта до выбора (list of URLs).
ALTER TABLE users ADD COLUMN IF NOT EXISTS card_photo_url TEXT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS card_photo_source TEXT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS card_photo_candidates JSONB NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_card_photo_source_check') THEN
    ALTER TABLE users
      ADD CONSTRAINT users_card_photo_source_check
      CHECK (card_photo_source IS NULL OR card_photo_source IN ('ai', 'raw'));
  END IF;
END$$;

-- ---------- player_stats: restore стрика ----------
-- При сломе closure-джоб пишет длину/момент ДО обнуления; restore доступен 72ч.
ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS lost_streak_len SMALLINT NULL;
ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS lost_streak_at TIMESTAMPTZ NULL;

-- ---------- workout_sessions: полная сессия ----------
-- true ⇔ done == плановому числу упражнений типа сессии (закрывает день).
ALTER TABLE workout_sessions ADD COLUMN IF NOT EXISTS completed_full BOOLEAN NOT NULL DEFAULT false;
