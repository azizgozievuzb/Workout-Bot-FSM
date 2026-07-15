-- 027_rename_xp_to_drops_balance.sql
-- Rename in-game currency balance: player_stats.xp_balance → drops_balance.
--
-- Background:
--   * Migration 023 renamed star_balance → xp_balance.
--   * Migration 026 renamed the per-session reward stars_earned → drops_earned (Капли 💧).
--   * The wallet balance is the same in-game currency, so it is renamed to match: drops_balance.
--   * NOTE: "XP" as the quality score (avg) on the finish card is a DIFFERENT concept and is
--     NOT touched here — only the currency balance column is renamed.
--
-- Safety:
--   * IF EXISTS / IF NOT EXISTS makes this idempotent.
--   * Existing data is preserved (column rename, not drop+add).
--   * Backend code in Session 41 (7.3.1) starts reading/writing drops_balance in the same deploy.

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
