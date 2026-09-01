-- ============================================================
-- Migration 039 (S67): XP, уровни, награды за уровень, свободная тренировка.
--
--   * app_settings — 7 чисел экономики XP/уровней (админ-редактируемые,
--     хардкода в коде нет; дефолты = решение юзера 02.09).
--   * player_stats.last_rewarded_level — идемпотентность выдачи наград:
--     уровень награждается ровно один раз, даже если XP пересчитают.
--   * workout_sessions.is_free — свободная тренировка (день вне плана):
--     без камеры, без Gemini, без начислений, вне антифарм-полей.
--
-- Idempotent (safe to re-run).
-- ============================================================

-- ---------- app_settings: экономика XP и лестницы уровней ----------
-- XP = round(workout_sessions.total_score × множитель по типу сессии).
-- Стоимость уровня N:
--   N <= level_boundary : level_base × level_early_step^(N-1)
--   N >  level_boundary : level_base × level_early_step^(boundary-1)
--                                    × level_late_step^(N-boundary)
-- Дефолты дают лестницу 500 / 625 / 781 / 1562 / 3125 / 6250 / 12500…
-- (кумулятив: L3 ≈ 1906 ≈ месяц при 3 main/нед, L6 ≈ 12.8k ≈ 7 мес).
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS xp_mult_main      NUMERIC(8,4) NOT NULL DEFAULT 0.1;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS xp_mult_light     NUMERIC(8,4) NOT NULL DEFAULT 0.1;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS level_base        INT          NOT NULL DEFAULT 500;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS level_early_step  NUMERIC(8,4) NOT NULL DEFAULT 1.25;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS level_late_step   NUMERIC(8,4) NOT NULL DEFAULT 2.0;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS level_boundary    SMALLINT     NOT NULL DEFAULT 3;
-- Разовая выдача заморозок за взятие уровня: {"уровень": сколько}.
-- Уровни 4+ намеренно пусты — награды за них решаются отдельно (BACKLOG 02.09 п.2).
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS level_freeze_rewards JSONB NOT NULL
    DEFAULT '{"1": 1, "2": 2, "3": 3}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_settings_xp_sane_check') THEN
    ALTER TABLE app_settings
      ADD CONSTRAINT app_settings_xp_sane_check
      CHECK (
        xp_mult_main     >= 0
        AND xp_mult_light >= 0
        AND level_base    >= 1
        AND level_early_step >= 1
        AND level_late_step  >= 1
        AND level_boundary   >= 1
      );
  END IF;
END$$;

-- ---------- player_stats: идемпотентность наград за уровень ----------
-- Наивысший уровень, за который награда уже выдана. Выдача идёт ТОЛЬКО за
-- (last_rewarded_level, текущий уровень] — повторный проход не дублирует.
ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS last_rewarded_level SMALLINT NOT NULL DEFAULT 0;

-- Живым игрокам, у кого XP уже есть (на 039 таких нет — global_score мёртв),
-- уровень не задним числом: стартуем с 0 и награждаем по мере роста.

-- ---------- workout_sessions: свободная тренировка ----------
-- is_free = день вне плана. session_type остаётся 'light' (4 упражнения,
-- light-тайминги) — тип нужен движку; отличие в том, что клипы не пишутся,
-- Gemini не зовётся, начислений нет и антифарм-поля дня не трогаются.
ALTER TABLE workout_sessions ADD COLUMN IF NOT EXISTS is_free BOOLEAN NOT NULL DEFAULT false;
