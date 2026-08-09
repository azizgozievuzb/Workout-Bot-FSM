-- 042 — S62-5: «только вниз» распространяется на видео-обещания.
--
-- Было (S62-3.2): цена лота каталога менялась только вниз через RPC, а цена
-- обещания — свободным вводом в админ-лимитах, вверх в том числе. Игрок,
-- копящий на обещание, мог увидеть его подорожавшим — ровно то, что запрещало
-- решение S62-2 для лотов. Причина различия («личный товар наставника») юзера
-- не убедила: копит игрок одинаково в обоих случаях.
--
-- Здесь обобщаем `set_shelf_item_price` на оба типа: гейты «только вниз» и
-- статус-проверка общие, различается только КОРИДОР —
--   star_item : 10 … app_month_cap_drops(player)   (потолок конкретного игрока)
--   promise   : админ-лимиты app_shop_items['shelf_lot'].meta (min/max)
-- Дороже прежнего — только снять лот и выставить заново.
--
-- Ветка NOT_A_CATALOG_LOT из 040 больше не нужна и удалена: теперь функция
-- принимает оба типа. Идемпотентна (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION set_shelf_item_price(
    p_responsible_id uuid, p_item_id uuid, p_price int
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_item   shelf_items%ROWTYPE;
    v_player uuid;
    v_meta   jsonb;
    v_min    int;
    v_max    int;
BEGIN
    SELECT si.* INTO v_item
      FROM shelf_items si
      JOIN partnerships p ON p.id = si.partnership_id
     WHERE si.id = p_item_id
       AND p.responsible_id = p_responsible_id
       AND p.status = 'active'
     FOR UPDATE OF si;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ITEM_NOT_FOUND');
    END IF;
    IF v_item.status NOT IN ('active', 'hidden') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ITEM_LOCKED', 'status', v_item.status);
    END IF;

    IF v_item.type = 'promise' THEN
        -- Админ-лимиты; дефолты держим теми же, что PRICE_MIN/MAX_DEFAULT
        -- в services/shelf.py — правишь здесь, правь там.
        SELECT meta INTO v_meta FROM app_shop_items
         WHERE key = 'shelf_lot' AND is_active = true;
        v_min := coalesce((v_meta->>'min')::int, 50);
        v_max := coalesce((v_meta->>'max')::int, 2000);
    ELSE
        -- Ниже 10 💧 лот дублирует прямое дарение капель (S62-3.2).
        v_min := 10;
        SELECT player_id INTO v_player FROM partnerships WHERE id = v_item.partnership_id;
        v_max := app_month_cap_drops(v_player);
    END IF;

    IF p_price IS NULL OR p_price < v_min OR p_price > v_max THEN
        RETURN jsonb_build_object('ok', false, 'code', 'PRICE_OUT_OF_CORRIDOR',
                                  'min', v_min, 'max', v_max);
    END IF;
    IF p_price > v_item.price_drops THEN
        RETURN jsonb_build_object('ok', false, 'code', 'PRICE_ONLY_DOWN',
                                  'current', v_item.price_drops);
    END IF;

    UPDATE shelf_items SET price_drops = p_price WHERE id = p_item_id;

    RETURN jsonb_build_object('ok', true, 'price_drops', p_price,
                              'min', v_min, 'max', v_max);
END $$;
