-- AccessTier
CREATE TYPE access_tier AS ENUM ('standard', 'premium', 'elite');

ALTER TABLE promo_codes
  ADD COLUMN access_tier access_tier NOT NULL DEFAULT 'standard',
  ADD COLUMN is_renewal BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE users
  ADD COLUMN access_tier access_tier NOT NULL DEFAULT 'standard',
  ADD COLUMN ban_until TIMESTAMPTZ NULL,
  ADD COLUMN ban_reason TEXT NULL,
  ADD COLUMN ban_missed_workouts INT NOT NULL DEFAULT 0;

-- App-wide settings (single row)
CREATE TABLE IF NOT EXISTS app_settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  maintenance_mode BOOLEAN NOT NULL DEFAULT FALSE,
  maintenance_started_at TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO app_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

-- Renewal requests (Player → Responsible notifications)
CREATE TABLE IF NOT EXISTS renewal_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  responsible_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ NULL
);
CREATE INDEX idx_renewal_unresolved
  ON renewal_requests(responsible_id) WHERE resolved_at IS NULL;
