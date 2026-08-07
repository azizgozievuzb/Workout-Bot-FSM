ALTER TABLE promo_codes DROP CONSTRAINT IF EXISTS promo_duration_check;
ALTER TABLE promo_codes ADD CONSTRAINT promo_duration_check CHECK (duration_days IN (7, 30, 90, 180));