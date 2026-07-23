-- ============================================================
-- Migration 034: Phase 8a foundation
--   timezone + schedule (3 main-days) + streak/freeze rework + reminders
-- Idempotent (safe to re-run).
-- ============================================================

-- ---------- users: timezone ----------
-- Рабочая TZ (IANA). NULL => фолбэк UTC в джобах.
ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone TEXT NULL;
-- Детектированная фронтом TZ (для диалога «Обновить?» в 8e); НЕ рабочая.
ALTER TABLE users ADD COLUMN IF NOT EXISTS detected_timezone TEXT NULL;

-- ---------- users: расписание (роль игрока) ----------
-- 3 дня недели, 0=пн … 6=вс (совместимо с Python date.weekday()).
ALTER TABLE users ADD COLUMN IF NOT EXISTS main_days SMALLINT[] NULL;
-- Отложенная смена графика: применяется со следующего понедельника.
ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_main_days SMALLINT[] NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_schedule_from DATE NULL;
-- Кулдаун смены (30 дней) считается от schedule_changed_at.
ALTER TABLE users ADD COLUMN IF NOT EXISTS schedule_changed_at TIMESTAMPTZ NULL;
-- Онбординговый grace (+14 дней): внутри — смена бесплатно/мгновенно/без кулдауна.
ALTER TABLE users ADD COLUMN IF NOT EXISTS schedule_grace_until TIMESTAMPTZ NULL;

-- ---------- users: утреннее напоминание + тротлы ----------
ALTER TABLE users ADD COLUMN IF NOT EXISTS morning_reminder_time TIME NOT NULL DEFAULT '08:00';
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_morning_reminder_date DATE NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_evening_reminder_date DATE NULL;

-- ---------- player_stats: заморозки (новая пара) ----------
-- free_freezes_left  — грант по полу (Ж 3 / М 1), reset 1-го числа, НЕ копится.
--   Мигрируем из существующего rest_days_remaining («3/мес девушкам»).
-- paid_freezes       — докупленные/подаренные (кап запаса 3); докупка придёт в 8c.
--   Мигрируем из streak_freeze_balance (старый кошелёк заморозок игрока).
ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS free_freezes_left SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS paid_freezes SMALLINT NOT NULL DEFAULT 0;

-- Перенос данных (только если новые поля ещё нулевые, чтобы повторный прогон не затирал).
UPDATE player_stats
   SET free_freezes_left = LEAST(GREATEST(COALESCE(rest_days_remaining, 0), 0), 3)
 WHERE free_freezes_left = 0 AND COALESCE(rest_days_remaining, 0) > 0;

UPDATE player_stats
   SET paid_freezes = LEAST(GREATEST(COALESCE(streak_freeze_balance, 0), 0), 3)
 WHERE paid_freezes = 0 AND COALESCE(streak_freeze_balance, 0) > 0;

-- Кап запаса докупленных = 3.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'player_stats_paid_freezes_cap') THEN
    ALTER TABLE player_stats
      ADD CONSTRAINT player_stats_paid_freezes_cap
      CHECK (paid_freezes >= 0 AND paid_freezes <= 3);
  END IF;
END$$;

-- ---------- player_stats: честный учёт закрытия планового дня ----------
-- last_closed_day     — последний плановый main-день, закрытый тренировкой (по локальной TZ).
-- last_streak_eval_day — последний локальный день, обработанный почасовым closure-джобом (идемпотентность).
ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS last_closed_day DATE NULL;
ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS last_streak_eval_day DATE NULL;
