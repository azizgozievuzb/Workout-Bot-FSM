-- 038 (8d): полка наставника — видео-обещания, Stars-предметы, слоты по тиру,
-- gift_balance + drop packs + дарение капель. Выпил бустов и легаси-магазина.
-- Idempotent.

-- ===========================================================================
-- 1. Колонки
-- ===========================================================================

-- Пул капель Ответственного для дарения (закупается за Stars пакетами).
-- У игрока по-прежнему ОДИН drops_balance (§8.6).
ALTER TABLE users ADD COLUMN IF NOT EXISTS gift_balance INT NOT NULL DEFAULT 0;

-- Кредит реролла фото-карточки — подарок вне прогрессии цен (star_item полки).
ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS reroll_credits SMALLINT NOT NULL DEFAULT 0;

-- Контекст исполнения платежа (pack_key/drops, catalog_key/price_drops/player_id).
-- amount_stars остаётся снапшотом цены в звёздах.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS meta JSONB;

-- ===========================================================================
-- 2. Каталог Stars-предметов полки (v1: заморозка + реролл фото)
-- ===========================================================================

CREATE TABLE IF NOT EXISTS shelf_catalog (
    key         TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    price_stars INT NOT NULL CHECK (price_stars >= 1),
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Цены — плейсхолдеры, правятся админ-редактором (/admin/shelf-catalog).
INSERT INTO shelf_catalog (key, title, price_stars) VALUES
    ('freeze',       '❄️ Заморозка стрика',        50),
    ('photo_reroll', '🎲 Реролл фото-карточки',    30)
ON CONFLICT (key) DO NOTHING;

-- ===========================================================================
-- 3. Пакеты капель (закупка пула дарения за Stars)
-- ===========================================================================

CREATE TABLE IF NOT EXISTS drop_packs (
    key         TEXT PRIMARY KEY,
    drops       INT NOT NULL CHECK (drops >= 1),
    price_stars INT NOT NULL CHECK (price_stars >= 1),
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Плейсхолдеры §8.7: 100💧=100⭐, 300💧=250⭐, 1000💧=700⭐.
INSERT INTO drop_packs (key, drops, price_stars) VALUES
    ('pack_100',   100, 100),
    ('pack_300',   300, 250),
    ('pack_1000', 1000, 700)
ON CONFLICT (key) DO NOTHING;

-- ===========================================================================
-- 4. Полка наставника
-- ===========================================================================
-- Слоты по тиру (std 2 / prm 4 / elt 6 на игрока) считаются от ЖИВОЙ подписки R
-- и в строку НЕ снапшотятся (принцип BACKLOG S48 №1).
-- Слот занимают active и hidden; purchased/fulfilled/archived — освобождают.

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

-- Админ-лимиты цены лота полки (50–2000 💧) — редактируемая настройка.
-- Живёт в app_shop_items, чтобы не плодить админ-редакторы: price_drops = min,
-- meta.max = max (существующий PATCH /admin/app-shop-items/{key} правит оба).
INSERT INTO app_shop_items (key, title, price_drops, is_active, meta) VALUES
    ('shelf_lot', 'Полка наставника — лимиты цены лота', 50, TRUE, '{"min": 50, "max": 2000}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ===========================================================================
-- 5. RPC (паттерн 037: FOR UPDATE, одна транзакция)
-- ===========================================================================

-- Покупка лота полки игроком за капли. Гейт status='active' + принадлежность
-- лота ЖИВОЙ паре игрока; кап заморозок проверяется ДО списания.
CREATE OR REPLACE FUNCTION buy_shelf_item(p_player_id uuid, p_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_item        shelf_items%ROWTYPE;
    v_bal         int;
    v_paid        int;
    v_new_status  text;
BEGIN
    SELECT si.* INTO v_item
      FROM shelf_items si
      JOIN partnerships p ON p.id = si.partnership_id
     WHERE si.id = p_item_id
       AND p.player_id = p_player_id
       AND p.status = 'active'
     FOR UPDATE OF si;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ITEM_NOT_FOUND');
    END IF;
    IF v_item.status <> 'active' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ITEM_NOT_AVAILABLE', 'status', v_item.status);
    END IF;

    SELECT drops_balance, paid_freezes INTO v_bal, v_paid
      FROM player_stats WHERE player_id = p_player_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'PLAYER_STATS_MISSING');
    END IF;

    -- Кап запаса заморозок (3) — ДО списания капель.
    IF v_item.type = 'star_item' AND v_item.star_catalog_key = 'freeze'
       AND COALESCE(v_paid, 0) >= 3 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'FREEZE_CAP',
                                  'paid_freezes', COALESCE(v_paid, 0));
    END IF;

    IF COALESCE(v_bal, -1) < v_item.price_drops THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INSUFFICIENT_DROPS',
                                  'balance', COALESCE(v_bal, 0), 'price', v_item.price_drops);
    END IF;

    UPDATE player_stats SET drops_balance = v_bal - v_item.price_drops, updated_at = now()
     WHERE player_id = p_player_id;

    IF v_item.type = 'star_item' THEN
        IF v_item.star_catalog_key = 'freeze' THEN
            UPDATE player_stats SET paid_freezes = paid_freezes + 1 WHERE player_id = p_player_id;
        ELSIF v_item.star_catalog_key = 'photo_reroll' THEN
            UPDATE player_stats SET reroll_credits = reroll_credits + 1 WHERE player_id = p_player_id;
        END IF;
        -- Stars-предмет исполняется мгновенно (эффект уже выдан).
        v_new_status := 'fulfilled';
    ELSE
        -- Обещание уходит наставнику «к исполнению»; галочку ставит игрок.
        v_new_status := 'purchased';
    END IF;

    UPDATE shelf_items
       SET status = v_new_status,
           purchased_at = now(),
           fulfilled_at = CASE WHEN v_new_status = 'fulfilled' THEN now() ELSE NULL END
     WHERE id = p_item_id;

    RETURN jsonb_build_object(
        'ok', true,
        'balance', v_bal - v_item.price_drops,
        'status', v_new_status,
        'type', v_item.type,
        'star_catalog_key', v_item.star_catalog_key,
        'price_drops', v_item.price_drops
    );
END $$;

-- Дарение капель: атомарный перевод из gift_balance R в drops_balance игрока.
CREATE OR REPLACE FUNCTION gift_drops(p_responsible_id uuid, p_player_id uuid, p_amount int)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_gift int;
    v_bal  int;
BEGIN
    IF p_amount IS NULL OR p_amount < 1 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'BAD_AMOUNT');
    END IF;

    PERFORM 1 FROM partnerships
     WHERE responsible_id = p_responsible_id AND player_id = p_player_id AND status = 'active';
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'NOT_YOUR_PLAYER');
    END IF;

    SELECT gift_balance INTO v_gift FROM users WHERE id = p_responsible_id FOR UPDATE;
    IF COALESCE(v_gift, 0) < p_amount THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INSUFFICIENT_GIFT_BALANCE',
                                  'gift_balance', COALESCE(v_gift, 0));
    END IF;

    SELECT drops_balance INTO v_bal FROM player_stats WHERE player_id = p_player_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'PLAYER_STATS_MISSING');
    END IF;

    UPDATE users SET gift_balance = v_gift - p_amount WHERE id = p_responsible_id;
    UPDATE player_stats SET drops_balance = COALESCE(v_bal, 0) + p_amount, updated_at = now()
     WHERE player_id = p_player_id;

    RETURN jsonb_build_object('ok', true,
                              'gift_balance', v_gift - p_amount,
                              'player_balance', COALESCE(v_bal, 0) + p_amount);
END $$;

-- Пополнение пула дарения после успешной оплаты пакета (идемпотентность —
-- на уровне payments mark-paid, как у остальных product_type).
CREATE OR REPLACE FUNCTION credit_gift_balance(p_user_id uuid, p_drops int)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_gift int;
BEGIN
    IF p_drops IS NULL OR p_drops < 1 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'BAD_AMOUNT');
    END IF;
    SELECT gift_balance INTO v_gift FROM users WHERE id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;
    UPDATE users SET gift_balance = COALESCE(v_gift, 0) + p_drops WHERE id = p_user_id;
    RETURN jsonb_build_object('ok', true, 'gift_balance', COALESCE(v_gift, 0) + p_drops);
END $$;

-- Реролл фото-карточки: сначала тратим подаренный кредит (капли не списываем,
-- счётчик прогрессии card_rerolls НЕ двигаем), дальше — обычный платный путь (037).
CREATE OR REPLACE FUNCTION begin_card_reroll(p_user_id uuid, p_price int)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_bal     int;
    v_credits int;
    v_status  text;
BEGIN
    SELECT drops_balance, reroll_credits INTO v_bal, v_credits
      FROM player_stats WHERE player_id = p_user_id FOR UPDATE;
    SELECT card_photo_candidates->>'status' INTO v_status FROM users WHERE id = p_user_id FOR UPDATE;
    IF v_status IS DISTINCT FROM 'choosing' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'NOT_CHOOSING', 'balance', COALESCE(v_bal, 0));
    END IF;

    IF COALESCE(v_credits, 0) > 0 THEN
        UPDATE player_stats SET reroll_credits = v_credits - 1, updated_at = now()
         WHERE player_id = p_user_id;
        UPDATE users SET card_photo_candidates = jsonb_build_object('status', 'processing', 'mode', 'ai')
         WHERE id = p_user_id;
        RETURN jsonb_build_object('ok', true, 'balance', COALESCE(v_bal, 0),
                                  'used_credit', true, 'reroll_credits', v_credits - 1);
    END IF;

    IF COALESCE(v_bal, -1) < p_price THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INSUFFICIENT_DROPS', 'balance', COALESCE(v_bal, 0));
    END IF;
    UPDATE player_stats SET drops_balance = v_bal - p_price, updated_at = now()
     WHERE player_id = p_user_id;
    UPDATE users SET
        card_photo_candidates = jsonb_build_object('status', 'processing', 'mode', 'ai'),
        card_rerolls = card_rerolls + 1
     WHERE id = p_user_id;
    RETURN jsonb_build_object('ok', true, 'balance', v_bal - p_price,
                              'used_credit', false, 'reroll_credits', 0);
END $$;

-- ===========================================================================
-- 6. Приватный бакет для видео-обещаний (§8.8a п.8)
-- ===========================================================================
-- Доступ ТОЛЬКО подписанными ссылками, выдаваемыми бэком паре. Публичного
-- чтения нет; политик storage.objects для anon/authenticated не создаём —
-- service_role бэкенда обходит RLS.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('promises', 'promises', FALSE, 52428800,
        ARRAY['video/webm', 'video/mp4', 'video/quicktime'])
ON CONFLICT (id) DO UPDATE SET public = FALSE;

-- ===========================================================================
-- 7. Выпил бустов и легаси-магазина (решение юзера S55)
-- ===========================================================================
-- Историю payments с product_type='boost_*' НЕ трогаем (FK на star_products нет).

DROP TABLE IF EXISTS purchases;     -- FK → shop_items, боевых строк нет
DROP TABLE IF EXISTS shop_items;
DROP TABLE IF EXISTS boosts;

DELETE FROM star_products WHERE product_type IN ('boost_1_day', 'boost_1_week');
