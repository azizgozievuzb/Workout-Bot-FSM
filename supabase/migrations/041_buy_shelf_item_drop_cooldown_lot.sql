-- 041 (допостановка v2, S62-3.1): из RPC выкупа уходит ветка отменённого лота
-- `schedule_cooldown_reset`. Мёртвая ветка гейта — тот же класс мусора, что
-- freeze/photo_reroll в 039b: смена модели → вычистить ВСЕ фильтры (урок №7).
-- Остальное тело 039b не меняется. Идемпотентна (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION buy_shelf_item(p_player_id uuid, p_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_item       shelf_items%ROWTYPE;
    v_u          users%ROWTYPE;
    v_bal        int;
    v_new_status text;
    v_key        text;
    v_title      text;
    v_from       date;
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

    v_key := v_item.star_catalog_key;

    SELECT * INTO v_u FROM users WHERE id = p_player_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'PLAYER_NOT_FOUND');
    END IF;

    -- Гейты эффекта проверяются ДО списания: капли не должны сгорать впустую.
    IF v_item.type = 'star_item' THEN
        IF v_key = 'light_trial' THEN
            IF COALESCE(v_u.light_unlocked, false) OR COALESCE(v_u.light_trial_used, false) THEN
                RETURN jsonb_build_object('ok', false, 'code', 'LIGHT_TRIAL_UNAVAILABLE');
            END IF;
        ELSIF v_key = 'title' THEN
            v_title := NULLIF(btrim(COALESCE(v_item.meta->>'title_text', '')), '');
            IF v_title IS NULL THEN
                RETURN jsonb_build_object('ok', false, 'code', 'TITLE_TEXT_MISSING');
            END IF;
        END IF;
    END IF;

    -- Цена берётся У ЛОТА, а не из каталога (S62-2): каталожная цена — лишь
    -- рекомендованный ориентир, фактическую назначил наставник при размещении.
    SELECT drops_balance INTO v_bal
      FROM player_stats WHERE player_id = p_player_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'PLAYER_STATS_MISSING');
    END IF;
    IF COALESCE(v_bal, -1) < v_item.price_drops THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INSUFFICIENT_DROPS',
                                  'balance', COALESCE(v_bal, 0), 'price', v_item.price_drops);
    END IF;

    UPDATE player_stats SET drops_balance = v_bal - v_item.price_drops, updated_at = now()
     WHERE player_id = p_player_id;

    IF v_item.type = 'star_item' THEN
        IF v_key = 'light_trial' THEN
            v_from := app_next_monday(app_local_today(v_u.timezone));
            UPDATE users
               SET light_trial_used  = TRUE,
                   light_trial_from  = v_from,
                   light_trial_until = v_from + 7
             WHERE id = p_player_id;
        ELSIF v_key = 'title' THEN
            UPDATE users SET player_title = v_title WHERE id = p_player_id;
        END IF;
        v_new_status := 'fulfilled';
    ELSE
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
        'star_catalog_key', v_key,
        'price_drops', v_item.price_drops
    );
END $$;
