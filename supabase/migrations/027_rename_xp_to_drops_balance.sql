DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'player_stats'
      AND column_name = 'xp_balance'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'player_stats'
      AND column_name = 'drops_balance'
  ) THEN
    ALTER TABLE player_stats RENAME COLUMN xp_balance TO drops_balance;
  END IF;
END $$;