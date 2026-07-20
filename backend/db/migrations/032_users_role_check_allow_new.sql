-- 032: allow role='new' in users.role CHECK (fixes /auth/register 500)
-- prev def: CHECK (role IN ('player','responsible','admin')) — missing 'new'
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('new', 'player', 'responsible', 'admin'));
