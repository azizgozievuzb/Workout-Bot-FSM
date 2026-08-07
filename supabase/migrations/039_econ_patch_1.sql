-- 039 (эконом-патч №1): каталог полки — чистый эксклюзив (Э.1) + ядро v1 (Э.2a),
-- заморозка дарением из пула (хвост 4), звание игрока, light-трайал.
-- Идемпотентна целиком (IF EXISTS / IF NOT EXISTS / ON CONFLICT).

-- ===== П.1 — freeze и photo_reroll уходят из каталога полки =====
-- Выставленных лотов этих типов на живых полках нет (сверено SELECT-ом до
-- миграции: 0 строк в shelf_items при любом статусе), FK не держит.
DELETE FROM shelf_catalog WHERE key IN ('freeze', 'photo_reroll');

-- ===== П.2 — цена лота в каплях переезжает в каталог =====
-- До 039 наставник вводил цену руками; цены Э.2a утверждены как финальные v1,
-- поэтому источник правды один — строка каталога (анти-арбитраж Э.1/Э.5).
ALTER TABLE shelf_catalog ADD COLUMN IF NOT EXISTS price_drops INT;

INSERT INTO shelf_catalog (key, title, price_stars, price_drops) VALUES
    ('light_trial',             '🌤 Light-трайал на неделю',   100, 100),
    ('schedule_cooldown_reset', '🔄 Сброс кулдауна графика',    50, 100),
    ('title',                   '🏅 Звание от наставника',      30,  50)
ON CONFLICT (key) DO NOTHING;

-- Страховка для строк, переживших прошлые прогоны без price_drops.
UPDATE shelf_catalog SET price_drops = price_stars WHERE price_drops IS NULL;
ALTER TABLE shelf_catalog ALTER COLUMN price_drops SET NOT NULL;
DO $$ BEGIN
    ALTER TABLE shelf_catalog ADD CONSTRAINT shelf_catalog_price_drops_check
        CHECK (price_drops >= 1);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Свободный текст звания, введённый наставником при покупке лота.
ALTER TABLE shelf_items ADD COLUMN IF NOT EXISTS meta JSONB;

-- ===== П.2 — звание игрока и light-трайал =====
ALTER TABLE users ADD COLUMN IF NOT EXISTS player_title TEXT;
-- Трайал одноразовый: used взводится навсегда, окно [from, until) — те же
-- «со следующего пн» и «+неделя», что у unlock/lock. Второго календаря нет.
ALTER TABLE users ADD COLUMN IF NOT EXISTS light_trial_used BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS light_trial_from DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS light_trial_until DATE;

-- ===== П.3 — упразднение gift_freeze_balance (легаси 020) =====
-- Запас пополнять было нечем (дыра Э.1); дарение теперь списывает капли из
-- gift_balance по витринной цене. Ненулевых значений в БД не было.
ALTER TABLE users DROP COLUMN IF EXISTS gift_freeze_balance;
