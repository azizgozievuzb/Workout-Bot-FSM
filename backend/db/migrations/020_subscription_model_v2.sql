-- 020_subscription_model_v2.sql
-- Subscription lives only on partnerships.expires_at (per-player).
-- Two freeze wallets on Responsible, streak_freeze on Player, manual rest-days.
-- New promo code types: renewal, bonus_pack_shop, bonus_pack_gift.
-- Per-player shop_items (responsible lots), notifications table, hard-delete cascades.

-- ===== 1. promo_codes: new code types, drop is_renewal, nullable access_tier =====
ALTER TABLE promo_codes DROP CONSTRAINT IF EXISTS promo_codes_code_type_check;
ALTER TABLE promo_codes
  ADD CONSTRAINT promo_codes_code_type_check
  CHECK (code_type IN ('responsible','player','renewal','bonus_pack_shop','bonus_pack_gift'));

ALTER TABLE promo_codes DROP COLUMN IF EXISTS is_renewal;

ALTER TABLE promo_codes ALTER COLUMN access_tier DROP DEFAULT;
ALTER TABLE promo_codes ALTER COLUMN access_tier DROP NOT NULL;

ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS freeze_count INTEGER;
ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS price_stars INTEGER;

-- ===== 2. users: two freeze wallets =====
ALTER TABLE users ADD COLUMN IF NOT EXISTS shop_freeze_balance INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS gift_freeze_balance INTEGER NOT NULL DEFAULT 0;

-- ===== 3. player_stats: streak_freeze + manual rest-day date =====
ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS streak_freeze_balance INTEGER NOT NULL DEFAULT 0;
ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS last_rest_day_date DATE NULL;

-- ===== 4. shop_items: per-player Responsible lots =====
ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS responsible_id UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS player_id UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS item_type VARCHAR(32) NOT NULL DEFAULT 'generic';
ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS freeze_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE shop_items ALTER COLUMN category DROP NOT NULL;
DO $$
DECLARE con_name text;
BEGIN
  SELECT conname INTO con_name FROM pg_constraint
  WHERE conrelid = 'public.shop_items'::regclass AND contype='c' AND conname LIKE '%category%';
  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE shop_items DROP CONSTRAINT %I', con_name);
  END IF;
END$$;

ALTER TABLE shop_items DROP CONSTRAINT IF EXISTS shop_items_owner_pair_check;
ALTER TABLE shop_items
  ADD CONSTRAINT shop_items_owner_pair_check
  CHECK (
    (responsible_id IS NULL AND player_id IS NULL) OR
    (responsible_id IS NOT NULL AND player_id IS NOT NULL)
  );

-- ===== 5. notifications table =====
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(32) NOT NULL,
  title TEXT NOT NULL,
  message TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications(user_id, read_at) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications(user_id, created_at DESC);

-- ===== 6. Indexes =====
CREATE INDEX IF NOT EXISTS idx_partnerships_expires_active
  ON partnerships(responsible_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_shop_items_responsible
  ON shop_items(responsible_id) WHERE responsible_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shop_items_player
  ON shop_items(player_id) WHERE player_id IS NOT NULL;

-- ===== 7. ON DELETE CASCADE for core FKs =====
ALTER TABLE partnerships DROP CONSTRAINT IF EXISTS partnerships_responsible_id_fkey;
ALTER TABLE partnerships
  ADD CONSTRAINT partnerships_responsible_id_fkey
  FOREIGN KEY (responsible_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE partnerships DROP CONSTRAINT IF EXISTS partnerships_player_id_fkey;
ALTER TABLE partnerships
  ADD CONSTRAINT partnerships_player_id_fkey
  FOREIGN KEY (player_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE player_stats DROP CONSTRAINT IF EXISTS player_stats_player_id_fkey;
ALTER TABLE player_stats
  ADD CONSTRAINT player_stats_player_id_fkey
  FOREIGN KEY (player_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE workout_sessions DROP CONSTRAINT IF EXISTS workout_sessions_player_id_fkey;
ALTER TABLE workout_sessions
  ADD CONSTRAINT workout_sessions_player_id_fkey
  FOREIGN KEY (player_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE workout_exercises DROP CONSTRAINT IF EXISTS workout_exercises_session_id_fkey;
ALTER TABLE workout_exercises
  ADD CONSTRAINT workout_exercises_session_id_fkey
  FOREIGN KEY (session_id) REFERENCES workout_sessions(id) ON DELETE CASCADE;
