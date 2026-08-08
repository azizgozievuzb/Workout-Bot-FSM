-- 040 (эконом-патч №1, допостановка v2 = решения S62-2 + S62-3):
--   * лот `schedule_cooldown_reset` исключён из каталога навсегда (S62-3.1);
--   * цену лота полки назначает НАСТАВНИК — 4 ступени-пресета или своя цифра
--     в коридоре [10 💧 … теоретический месячный потолок игрока] (S62-2, S62-3.2);
--   * менять цену выставленного лота можно ТОЛЬКО вниз — гейт живёт в RPC.
-- Идемпотентна целиком (CREATE OR REPLACE / DELETE по ключу).

-- ===== S62-3.1 — кулдаун-лот уходит из каталога =====
-- Причина: лот большую часть времени невыкупаем (гейт «нет активного кулдауна»)
-- и пересекается с платной сменой графика в витрине — два входа к одному эффекту.
-- Выставленных лотов этого типа не было ни одного (сверено SELECT-ом до миграции:
-- 0 строк при любом статусе). Снимаем только НЕвыкупленные: выкупленное — история
-- пары, она кормит репутацию наставника и переписывать её нельзя.
-- 039 сеет этот лот через ON CONFLICT DO NOTHING, поэтому при полном прогоне
-- истории миграций 040 идёт следом и снимает его снова — итог всегда «лота нет».
DELETE FROM shelf_items
 WHERE star_catalog_key = 'schedule_cooldown_reset'
   AND status IN ('active', 'hidden');
DELETE FROM shelf_catalog WHERE key = 'schedule_cooldown_reset';

-- Цена из каталога больше НЕ цена выкупа: это рекомендованный ориентир, по
-- которому подсвечивается ступень «рекомендуем». Фактическая цена — у лота.
COMMENT ON COLUMN shelf_catalog.price_drops IS
    'Рекомендованный ориентир цены выкупа (Э.5). Фактическую цену назначает '
    'наставник при размещении и хранит shelf_items.price_drops (S62-2).';


-- ===== S62-2 — теоретический месячный потолок капель игрока =====
-- Им подписаны ступени цены («при идеальном месяце игрок заработает до N 💧»)
-- и им же ограничен свободный ввод. ⚠️ Это потолок ФОРМУЛ, а не заработок
-- игрока: фактические капли и баланс наставнику не показываются никогда
-- (инвариант §1) и из потолка не вычисляются.
--
-- ⚠️ Зеркало питона: core/workout_config.month_cap_drops() и
-- services/schedule.light_is_active(). Цифры ОБЯЗАНЫ совпадать — иначе UI
-- покажет один коридор, а RPC отвергнет цену из него.

-- Локальная дата произвольного момента в поясе юзера (для light_locked_at).
CREATE OR REPLACE FUNCTION app_local_date(ts timestamptz, p_tz text)
RETURNS date LANGUAGE plpgsql STABLE AS $$
BEGIN
    RETURN (ts AT TIME ZONE COALESCE(NULLIF(p_tz, ''), 'UTC'))::date;
EXCEPTION WHEN OTHERS THEN
    RETURN (ts AT TIME ZONE 'UTC')::date;
END $$;

-- Зеркало services/schedule.light_is_active(): трайал → unlock → доживающий lock.
CREATE OR REPLACE FUNCTION app_light_is_active(p_player_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_u     users%ROWTYPE;
    v_today date;
BEGIN
    SELECT * INTO v_u FROM users WHERE id = p_player_id;
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;
    v_today := app_local_today(v_u.timezone);

    -- Неделя light-трайала — окно [from, until).
    IF v_u.light_trial_from IS NOT NULL AND v_u.light_trial_until IS NOT NULL
       AND v_today >= v_u.light_trial_from AND v_today < v_u.light_trial_until THEN
        RETURN TRUE;
    END IF;

    IF COALESCE(v_u.light_unlocked, FALSE) THEN
        RETURN v_u.light_active_from IS NOT NULL AND v_today >= v_u.light_active_from;
    END IF;

    -- Закрытый light доживает до следующего понедельника.
    IF v_u.light_locked_at IS NULL THEN
        RETURN FALSE;
    END IF;
    RETURN v_today < app_next_monday(app_local_date(v_u.light_locked_at, v_u.timezone));
END $$;

CREATE OR REPLACE FUNCTION app_month_cap_drops(p_player_id uuid)
RETURNS int LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_weekly int;
BEGIN
    -- Идеальный месяц: 3 main-дня × 50 💧 в неделю; в light-режиме плановыми
    -- становятся все семь дней, оставшиеся 4 — light × 30 💧. Недель в месяце
    -- 52/12. Константы = core/workout_config.py (MAX_DROPS_PER_SESSION,
    -- LIGHT_MAX_DROPS). Итог: 650 (main-only) / 1170 (light).
    v_weekly := 3 * 50;
    IF app_light_is_active(p_player_id) THEN
        v_weekly := v_weekly + 4 * 30;
    END IF;
    RETURN round(v_weekly * 52.0 / 12.0);
END $$;


-- ===== S62-2 / S62-3.2 — смена цены выставленного лота =====
-- Гейтов два, и оба обязаны жить здесь, а не в питоне: коридор (свободный ввод
-- проверяется НЕ только в UI) и «только вниз» (между чтением цены и записью
-- иначе есть окно гонки). Игрок, копящий на цену, не должен увидеть её выросшей.
-- Видео-обещания эта RPC не трогает: у них свободный ввод в админ-лимитах, как был.
CREATE OR REPLACE FUNCTION set_shelf_item_price(
    p_responsible_id uuid, p_item_id uuid, p_price int
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_item   shelf_items%ROWTYPE;
    v_player uuid;
    v_max    int;
    -- Ниже 10 💧 лот дублирует прямое дарение капель (S62-3.2).
    v_min    CONSTANT int := 10;
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
    IF v_item.type <> 'star_item' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'NOT_A_CATALOG_LOT');
    END IF;
    IF v_item.status NOT IN ('active', 'hidden') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ITEM_LOCKED', 'status', v_item.status);
    END IF;

    SELECT player_id INTO v_player FROM partnerships WHERE id = v_item.partnership_id;
    v_max := app_month_cap_drops(v_player);

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
