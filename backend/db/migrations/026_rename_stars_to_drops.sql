-- 026_rename_stars_to_drops.sql
-- Rename in-game currency: Stars → Drops (Капли 💧).
--
-- Background:
--   * Telegram Stars is a real-money currency (used for paid features in Phase 7.4+).
--   * To avoid naming collision, the in-game reward earned for finishing workouts is
--     renamed from "stars" to "drops" (Капли 💧).
--   * Migration 017 created workout_sessions.stars_earned. That is the only column
--     in the DB schema using the in-game "stars_*" naming. Other "stars" references
--     (promo_codes.price_stars, payments.payment_method='stars', shop_items.price_stars)
--     refer to real Telegram Stars and ARE NOT renamed.
--
-- Safety:
--   * IF EXISTS / IF NOT EXISTS makes this idempotent.
--   * Existing data is preserved (column rename, not drop+add).
--   * Backend code in Session 37 starts writing to drops_earned in the same deploy.

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
