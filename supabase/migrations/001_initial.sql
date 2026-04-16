-- ============================================================
-- Migration 001: Initial schema
-- Run in Supabase SQL Editor
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    telegram_id         BIGINT UNIQUE NOT NULL,
    telegram_username   VARCHAR(255),
    first_name          VARCHAR(255),
    role                VARCHAR(20) CHECK (role IN ('player', 'responsible', 'admin')) NOT NULL DEFAULT 'player',
    gender              VARCHAR(10) CHECK (gender IN ('male', 'female')),
    lang                VARCHAR(5)  CHECK (lang IN ('ru', 'uz', 'en')) DEFAULT 'ru',
    profile_photo_url   TEXT,
    onboarding_state    VARCHAR(50) DEFAULT 'languageSelection',  -- текущий шаг FSM
    onboarding_done     BOOLEAN DEFAULT FALSE,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_telegram_id ON users(telegram_id);

-- ============================================================
-- PARTNERSHIPS (Responsible ↔ Player, 1:N)
-- ============================================================
CREATE TABLE IF NOT EXISTS partnerships (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    responsible_id  UUID REFERENCES users(id) ON DELETE CASCADE,
    player_id       UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE,  -- у Player один Responsible
    pairing_code    VARCHAR(8) UNIQUE NOT NULL,
    status          VARCHAR(20) CHECK (status IN ('pending', 'active', 'blocked')) DEFAULT 'pending',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_partnerships_responsible ON partnerships(responsible_id);
CREATE INDEX idx_partnerships_player ON partnerships(player_id);
CREATE INDEX idx_partnerships_code ON partnerships(pairing_code);

-- ============================================================
-- SUBSCRIPTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS subscriptions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    partnership_id  UUID REFERENCES partnerships(id) ON DELETE CASCADE,
    payment_method  VARCHAR(20) CHECK (payment_method IN ('stars', 'promo', 'crypto')) NOT NULL,
    promo_code      VARCHAR(50),
    starts_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ NOT NULL,
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_subscriptions_partnership ON subscriptions(partnership_id);

-- ============================================================
-- PLAYER_STATS (кэш, обновляется после каждой тренировки)
-- ============================================================
CREATE TABLE IF NOT EXISTS player_stats (
    player_id           UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    global_score        INTEGER DEFAULT 0,
    three_day_score     INTEGER DEFAULT 0,
    current_streak      INTEGER DEFAULT 0,
    best_streak         INTEGER DEFAULT 0,
    last_workout_date   DATE,
    star_balance        INTEGER DEFAULT 0,
    level_window        JSONB DEFAULT '[1, 2, 3]'::jsonb,
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- AUTO-UPDATE updated_at trigger
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_player_stats_updated_at
    BEFORE UPDATE ON player_stats
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- RLS (Row Level Security) — базовая защита
-- ============================================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE partnerships ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_stats ENABLE ROW LEVEL SECURITY;

-- Бэкенд использует service_role key, поэтому RLS для него не применяется.
-- Ниже — политики на случай прямых запросов с anon key (для безопасности).
CREATE POLICY "service_role_all" ON users TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON partnerships TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON subscriptions TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON player_stats TO service_role USING (true) WITH CHECK (true);
