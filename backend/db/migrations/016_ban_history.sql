CREATE TABLE ban_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    banned_by UUID REFERENCES users(id),
    banned_at TIMESTAMPTZ DEFAULT NOW(),
    ban_until TIMESTAMPTZ NOT NULL,
    reason TEXT NOT NULL,
    missed_workouts INT DEFAULT 0,
    unbanned_early_at TIMESTAMPTZ NULL
);
CREATE INDEX idx_ban_history_user ON ban_history(user_id, banned_at DESC);
CREATE INDEX idx_ban_history_recent ON ban_history(banned_at DESC);
