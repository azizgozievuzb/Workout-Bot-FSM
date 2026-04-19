-- 019_promo_duration_180.sql
-- Allow 180-day codes (Elite VIP tier uses 180d by default).
-- Legacy constraint from 012 allowed only {7, 30, 90}.

ALTER TABLE promo_codes
  DROP CONSTRAINT IF EXISTS promo_duration_check;

ALTER TABLE promo_codes
  ADD CONSTRAINT promo_duration_check CHECK (duration_days IN (7, 30, 90, 180));
