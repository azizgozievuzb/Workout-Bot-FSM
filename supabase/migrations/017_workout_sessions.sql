-- ============================================================
-- Migration 017: Workout Sessions + Exercises
-- ============================================================

-- 1. workout_sessions
CREATE TABLE IF NOT EXISTS workout_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ NULL,
    status TEXT NOT NULL DEFAULT 'in_progress',
    total_score INT NOT NULL DEFAULT 0,
    stars_earned INT NOT NULL DEFAULT 0,
    client_tz_offset INT NULL
);

CREATE INDEX IF NOT EXISTS idx_workout_sessions_player
    ON workout_sessions(player_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_workout_sessions_active
    ON workout_sessions(player_id)
    WHERE status = 'in_progress';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workout_sessions_status_check') THEN
    ALTER TABLE workout_sessions
      ADD CONSTRAINT workout_sessions_status_check
      CHECK (status IN ('in_progress','finished','cancelled'));
  END IF;
END $$;

-- 2. workout_exercises
CREATE TABLE IF NOT EXISTS workout_exercises (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
    exercise_idx SMALLINT NOT NULL,
    exercise_key TEXT NOT NULL,
    video_url TEXT NULL,
    ai_score SMALLINT NOT NULL DEFAULT 0,
    feedback TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (session_id, exercise_idx)
);

CREATE INDEX IF NOT EXISTS idx_workout_exercises_session
    ON workout_exercises(session_id, exercise_idx);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workout_exercises_idx_check') THEN
    ALTER TABLE workout_exercises
      ADD CONSTRAINT workout_exercises_idx_check
      CHECK (exercise_idx >= 0 AND exercise_idx <= 15);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workout_exercises_score_check') THEN
    ALTER TABLE workout_exercises
      ADD CONSTRAINT workout_exercises_score_check
      CHECK (ai_score >= 0 AND ai_score <= 100);
  END IF;
END $$;