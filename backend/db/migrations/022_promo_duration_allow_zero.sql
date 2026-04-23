-- Allow duration_days=0 for bonus_pack_shop and bonus_pack_gift promo codes.
-- Applied manually on 2026-04-23 during §5 BonusPack E2E test.
ALTER TABLE promo_codes DROP CONSTRAINT promo_duration_check;
ALTER TABLE promo_codes ADD CONSTRAINT promo_duration_check
  CHECK (duration_days IS NULL OR duration_days = ANY (ARRAY[0, 7, 30, 90, 180]));
