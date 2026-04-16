-- ============================================================
-- Migration 011: Shop items, Purchases, Boosts
-- Run in Supabase SQL Editor
-- ============================================================

-- SHOP_ITEMS — каталог товаров
CREATE TABLE IF NOT EXISTS shop_items (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(100) NOT NULL,
    description     TEXT DEFAULT '',
    category        VARCHAR(30) CHECK (category IN ('skip', 'avatar', 'lootbox', 'troll', 'hardcore')) NOT NULL,
    price_stars     INTEGER NOT NULL CHECK (price_stars > 0),
    emoji           VARCHAR(10) DEFAULT '',
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- PURCHASES — история покупок
CREATE TABLE IF NOT EXISTS purchases (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    player_id       UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    item_id         UUID REFERENCES shop_items(id) ON DELETE CASCADE NOT NULL,
    price_paid      INTEGER NOT NULL,
    purchased_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_purchases_player ON purchases(player_id);

-- BOOSTS — X2 множители от Responsible
CREATE TABLE IF NOT EXISTS boosts (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    partnership_id  UUID REFERENCES partnerships(id) ON DELETE CASCADE NOT NULL,
    boost_type      VARCHAR(20) CHECK (boost_type IN ('1_day', '1_week')) NOT NULL,
    activated_at    TIMESTAMPTZ DEFAULT NOW(),
    expires_at      TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_boosts_partnership ON boosts(partnership_id);
CREATE INDEX idx_boosts_expires ON boosts(expires_at);

-- RLS
ALTER TABLE shop_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE boosts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON shop_items TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON purchases TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON boosts TO service_role USING (true) WITH CHECK (true);

-- SEED: начальные товары магазина
INSERT INTO shop_items (name, description, category, price_stars, emoji) VALUES
    ('Пропуск', 'Пропустить упражнение без потери очков', 'skip', 50, '⏭'),
    ('Аватар', 'Уникальный AI-аватар для профиля', 'avatar', 100, '🎭'),
    ('Лутбокс', 'Случайный приз (1-500 звёзд)', 'lootbox', 75, '📦'),
    ('Тролль', 'Подшутить над ответственным', 'troll', 200, '👹'),
    ('Хардкор', 'Режим X3 сложности на 1 тренировку', 'hardcore', 300, '🔥');
