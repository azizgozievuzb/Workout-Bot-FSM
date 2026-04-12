-- ============================================================
-- Migration 009: Activity feed table (Bond cube)
-- ============================================================

CREATE TABLE IF NOT EXISTS activity_feed (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    target_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_type      VARCHAR(30) CHECK (event_type IN (
        'workout_done', 'streak_lost', 'shop_purchase',
        'boost_activated', 'ping', 'milestone'
    )) NOT NULL,
    payload         JSONB DEFAULT '{}'::jsonb,
    is_read         BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_activity_feed_target ON activity_feed(target_user_id, created_at DESC);
CREATE INDEX idx_activity_feed_unread ON activity_feed(target_user_id) WHERE is_read = FALSE;

-- RLS
ALTER TABLE activity_feed ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON activity_feed TO service_role USING (true) WITH CHECK (true);
