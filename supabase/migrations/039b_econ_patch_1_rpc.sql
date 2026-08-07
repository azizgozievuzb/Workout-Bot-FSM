-- 039b: RPC эконом-патча №1.
--   * app_local_today / app_next_monday — «со следующего пн» в поясе игрока,
--     ровно та же математика, что в services/schedule.py (второго календаря нет).
--   * buy_shelf_item — мёртвые ветки freeze/photo_reroll убраны (Э.1),
--     добавлены три лота ядра v1 с гейтами ДО списания капель.
--   * gift_freeze — дарение заморозки за капли из пула наставника (хвост 4).

CREATE OR REPLACE FUNCTION app_local_today(p_tz text)
RETURNS date LANGUAGE plpgsql STABLE AS $$
BEGIN
    RETURN (now() AT TIME ZONE COALESCE(NULLIF(p_tz, ''), 'UTC'))::date;
EXCEPTION WHEN OTHERS THEN
    -- Битая зона в строке юзера не должна ронять покупку (фолбэк как в get_tz).
    RETURN (now() AT TIME ZONE 'UTC')::date;
END $$;

-- Ближайший понедельник СТРОГО после d: пн→+7, вс→+1 (= services/schedule.next_monday).
CREATE OR REPLACE FUNCTION app_next_monday(d date)
RETURNS date LANGUAGE sql IMMUTABLE AS $$
    SELECT d + (8 - EXTRACT(ISODOW FROM d)::int)
$$;


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
        ELSIF v_key = 'schedule_cooldown_reset' THEN
            -- Кулдаун активен = дни выбраны, grace прошёл, с прошлой смены < 30 дней.
            IF v_u.main_days IS NULL
               OR (v_u.schedule_grace_until IS NOT NULL AND v_u.schedule_grace_until > now())
               OR v_u.schedule_changed_at IS NULL
               OR v_u.schedule_changed_at + interval '30 days' <= now() THEN
                RETURN jsonb_build_object('ok', false, 'code', 'NO_ACTIVE_COOLDOWN');
            END IF;
        ELSIF v_key = 'title' THEN
            v_title := NULLIF(btrim(COALESCE(v_item.meta->>'title_text', '')), '');
            IF v_title IS NULL THEN
                RETURN jsonb_build_object('ok', false, 'code', 'TITLE_TEXT_MISSING');
            END IF;
        END IF;
    END IF;

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
        ELSIF v_key = 'schedule_cooldown_reset' THEN
            -- Кулдаун считается от schedule_changed_at; NULL = «смена доступна».
            UPDATE users SET schedule_changed_at = NULL WHERE id = p_player_id;
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


-- Дарение заморозки: 50💧 из пула наставника → +1 в запас игрока (кап 3).
-- Кап — на player_stats.paid_freezes (живой счётчик 034 с CHECK <= 3);
-- легаси streak_freeze_balance больше не пополняется никем.
CREATE OR REPLACE FUNCTION gift_freeze(p_responsible_id uuid, p_player_id uuid, p_price int)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_gift int;
    v_paid int;
BEGIN
    IF p_price IS NULL OR p_price < 1 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'BAD_PRICE');
    END IF;

    PERFORM 1 FROM partnerships
     WHERE responsible_id = p_responsible_id AND player_id = p_player_id AND status = 'active';
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'NOT_YOUR_PLAYER');
    END IF;

    SELECT gift_balance INTO v_gift FROM users WHERE id = p_responsible_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;

    SELECT COALESCE(paid_freezes, 0) INTO v_paid
      FROM player_stats WHERE player_id = p_player_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'PLAYER_STATS_MISSING');
    END IF;
    IF v_paid >= 3 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'FREEZE_CAP', 'paid_freezes', v_paid);
    END IF;

    IF COALESCE(v_gift, 0) < p_price THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INSUFFICIENT_GIFT_BALANCE',
                                  'gift_balance', COALESCE(v_gift, 0));
    END IF;

    UPDATE users SET gift_balance = v_gift - p_price WHERE id = p_responsible_id;
    UPDATE player_stats SET paid_freezes = v_paid + 1, updated_at = now()
     WHERE player_id = p_player_id;

    RETURN jsonb_build_object('ok', true,
                              'gift_balance', v_gift - p_price,
                              'paid_freezes', v_paid + 1);
END $$;
