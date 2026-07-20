-- 033_coupons_once_per_user.sql
-- Adds once_per_user flag to coupons: when true, a single user may apply the
-- coupon only once (enforced at tier-invoice creation). Idempotent.

ALTER TABLE coupons
    ADD COLUMN IF NOT EXISTS once_per_user BOOLEAN NOT NULL DEFAULT true;
