-- 037 (8c.1): прогрессирующие цены фото-карточки + атомарные RPC покупки/реролла.
-- Решение юзера (смоук 8c, находка №12):
--   * raw-смена — всегда фикс (photo_card.price_drops);
--   * AI-смена №k = price × mult^(k-1), кап meta.cap (счётчик users.card_ai_changes);
--   * реролл №m = photo_reroll.price × mult^(m-1), кап meta.cap
--     (счётчик users.card_rerolls, сбрасывается новой сменой);
--   * mult/cap админ-редактируемые (app_shop_items.meta).
-- RPC begin_card_purchase / begin_card_reroll — списание + смена стейта флоу
-- одной транзакцией (двойной клик не списывает дважды — находка №14).

ALTER TABLE users ADD COLUMN IF NOT EXISTS card_ai_changes SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS card_rerolls SMALLINT NOT NULL DEFAULT 0;

UPDATE app_shop_items
SET meta = COALESCE(meta, '{}'::jsonb) || '{"mult": 2, "cap": 3200}'::jsonb
WHERE key = 'photo_card' AND (meta IS NULL OR NOT meta ? 'mult');

UPDATE app_shop_items
SET meta = COALESCE(meta, '{}'::jsonb) || '{"mult": 2, "cap": 960}'::jsonb
WHERE key = 'photo_reroll' AND (meta IS NULL OR NOT meta ? 'mult');

-- Покупка смены фото: гейт «флоу не идёт» + списание + установка awaiting_photo
-- + инкремент счётчика AI-смен (только mode='ai') + сброс счётчика рероллов.
CREATE OR REPLACE FUNCTION begin_card_purchase(p_user_id uuid, p_price int, p_mode text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_bal int;
    v_status text;
BEGIN
    SELECT drops_balance INTO v_bal FROM player_stats WHERE player_id = p_user_id FOR UPDATE;
    SELECT card_photo_candidates->>'status' INTO v_status FROM users WHERE id = p_user_id FOR UPDATE;
    IF v_status IN ('awaiting_photo', 'processing', 'choosing') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'CARD_FLOW_PENDING', 'balance', COALESCE(v_bal, 0));
    END IF;
    IF COALESCE(v_bal, -1) < p_price THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INSUFFICIENT_DROPS', 'balance', COALESCE(v_bal, 0));
    END IF;
    UPDATE player_stats SET drops_balance = v_bal - p_price, updated_at = now()
    WHERE player_id = p_user_id;
    UPDATE users SET
        card_photo_candidates = jsonb_build_object('status', 'awaiting_photo', 'mode', p_mode),
        card_ai_changes = card_ai_changes + CASE WHEN p_mode = 'ai' THEN 1 ELSE 0 END,
        card_rerolls = 0
    WHERE id = p_user_id;
    RETURN jsonb_build_object('ok', true, 'balance', v_bal - p_price);
END $$;

-- Реролл: только из статуса choosing (второй клик увидит processing → отказ без списания).
CREATE OR REPLACE FUNCTION begin_card_reroll(p_user_id uuid, p_price int)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_bal int;
    v_status text;
BEGIN
    SELECT drops_balance INTO v_bal FROM player_stats WHERE player_id = p_user_id FOR UPDATE;
    SELECT card_photo_candidates->>'status' INTO v_status FROM users WHERE id = p_user_id FOR UPDATE;
    IF v_status IS DISTINCT FROM 'choosing' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'NOT_CHOOSING', 'balance', COALESCE(v_bal, 0));
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
    RETURN jsonb_build_object('ok', true, 'balance', v_bal - p_price);
END $$;
