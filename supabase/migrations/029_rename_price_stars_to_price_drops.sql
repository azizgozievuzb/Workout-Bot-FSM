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