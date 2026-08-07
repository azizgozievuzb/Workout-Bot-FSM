-- 038 (8d): полка наставника — видео-обещания, Stars-предметы, слоты по тиру,
-- gift_balance + drop packs + дарение капель. Выпил бустов и легаси-магазина.

ALTER TABLE users ADD COLUMN IF NOT EXISTS gift_balance INT NOT NULL DEFAULT 0;
ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS reroll_credits SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS meta JSONB;

CREATE TABLE IF NOT EXISTS shelf_catalog (
    key         TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    price_stars INT NOT NULL CHECK (price_stars >= 1),
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO shelf_catalog (key, title, price_stars) VALUES
    ('freeze',       '❄️ Заморозка стрика',     50),
    ('photo_reroll', '🎲 Реролл фото-карточки', 30)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS drop_packs (
    key         TEXT PRIMARY KEY,
    drops       INT NOT NULL CHECK (drops >= 1),
    price_stars INT NOT NULL CHECK (price_stars >= 1),
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO drop_packs (key, drops, price_stars) VALUES
    ('pack_100',   100, 100),
    ('pack_300',   300, 250),
    ('pack_1000', 1000, 700)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS shelf_items (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    partnership_id    UUID NOT NULL REFERENCES partnerships(id) ON DELETE CASCADE,
    type              TEXT NOT NULL CHECK (type IN ('promise', 'star_item')),
    title             TEXT NOT NULL,
    price_drops       INT NOT NULL CHECK (price_drops >= 1),
    status            TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'hidden', 'purchased', 'fulfilled', 'archived')),
    star_catalog_key  TEXT REFERENCES shelf_catalog(key),
    video_path        TEXT,
    purchased_at      TIMESTAMPTZ,
    fulfilled_at      TIMESTAMPTZ,
    report_video_path TEXT,
    last_reminder_at  TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shelf_items_partnership ON shelf_items(partnership_id, status);
CREATE INDEX IF NOT EXISTS idx_shelf_items_pending ON shelf_items(status, type);

ALTER TABLE shelf_items ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY "service_role_all" ON shelf_items TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

INSERT INTO app_shop_items (key, title, price_drops, is_active, meta) VALUES
    ('shelf_lot', 'Полка наставника — лимиты цены лота', 50, TRUE, '{"min": 50, "max": 2000}'::jsonb)
ON CONFLICT (key) DO NOTHING;