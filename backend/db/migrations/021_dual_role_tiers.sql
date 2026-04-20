-- 021_dual_role_tiers.sql
-- Split users.access_tier into two independent columns:
--   responsible_access_tier — tier for Responsible/Admin role (entitlement to issue codes).
--   player_access_tier      — tier inherited from Responsible when P-code is activated.
-- Legacy users.access_tier is kept read-only until migration 022 drops it.

ALTER TABLE users ADD COLUMN IF NOT EXISTS responsible_access_tier VARCHAR(16);
ALTER TABLE users ADD COLUMN IF NOT EXISTS player_access_tier VARCHAR(16);

-- Backfill: copy current access_tier into the correct role-specific column(s).
UPDATE users
   SET responsible_access_tier = access_tier
 WHERE (is_admin = TRUE OR has_responsible_access = TRUE)
   AND access_tier IS NOT NULL;

UPDATE users
   SET player_access_tier = access_tier
 WHERE has_player_access = TRUE
   AND access_tier IS NOT NULL;
