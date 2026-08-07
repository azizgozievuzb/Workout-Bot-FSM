ALTER TABLE users ADD COLUMN IF NOT EXISTS responsible_access_tier VARCHAR(16);
ALTER TABLE users ADD COLUMN IF NOT EXISTS player_access_tier VARCHAR(16);

UPDATE users
   SET responsible_access_tier = access_tier
 WHERE (is_admin = TRUE OR has_responsible_access = TRUE)
   AND access_tier IS NOT NULL;

UPDATE users
   SET player_access_tier = access_tier
 WHERE has_player_access = TRUE
   AND access_tier IS NOT NULL;
