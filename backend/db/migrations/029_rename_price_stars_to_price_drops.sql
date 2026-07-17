-- 029_rename_price_stars_to_price_drops.sql
-- Rename shop_items.price_stars → price_drops (Codex #9).
--
-- Background: shop lots are priced in the in-game currency Капли 💧 (drops), NOT Stars.
-- The column name was misleading. Renamed to match. This is the SHOP currency only.
--
-- IMPORTANT: promo_codes.price_stars is a DIFFERENT column (bonus-pack pricing) and is NOT touched.
--
-- Idempotent: DO-block guarded by information_schema (same pattern as migration 027).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'shop_items'
      AND column_name = 'price_stars'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'shop_items'
      AND column_name = 'price_drops'
  ) THEN
    ALTER TABLE shop_items RENAME COLUMN price_stars TO price_drops;
  END IF;
END $$;
