DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'workout_sessions'
      AND column_name = 'stars_earned'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'workout_sessions'
      AND column_name = 'drops_earned'
  ) THEN
    ALTER TABLE workout_sessions RENAME COLUMN stars_earned TO drops_earned;
  END IF;
END $$;