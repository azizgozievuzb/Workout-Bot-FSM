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
        'star_catalog_key', v_item.star_catalog_key,
        'price_drops', v_item.price_drops
    );
END $$;

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