-- ============================================================
-- RESET: удалить ВСЕ данные всех пользователей, кроме админа
-- ============================================================
-- Запускать в Supabase SQL Editor.
-- Админ определяется по users.is_admin = true.
-- Порядок: сначала зависимые таблицы, потом users.
-- ============================================================

BEGIN;

-- 1) activity_feed — события пользователей
DELETE FROM activity_feed
WHERE user_id IN (SELECT id FROM users WHERE is_admin = false);

-- 2) purchases — покупки в магазине
DELETE FROM purchases
WHERE user_id IN (SELECT id FROM users WHERE is_admin = false);

-- 3) boosts — активные бусты
DELETE FROM boosts
WHERE player_id IN (SELECT id FROM users WHERE is_admin = false)
   OR responsible_id IN (SELECT id FROM users WHERE is_admin = false);

-- 4) player_stats — статистика игроков
DELETE FROM player_stats
WHERE user_id IN (SELECT id FROM users WHERE is_admin = false);

-- 5) subscriptions — подписки
DELETE FROM subscriptions
WHERE user_id IN (SELECT id FROM users WHERE is_admin = false);

-- 6) partnerships — связи Responsible ↔ Player
DELETE FROM partnerships
WHERE responsible_id IN (SELECT id FROM users WHERE is_admin = false)
   OR player_id      IN (SELECT id FROM users WHERE is_admin = false);

-- 7) promo_codes — промокоды, выданные не-админам И использованные не-админами
DELETE FROM promo_codes
WHERE issued_to IN (SELECT id FROM users WHERE is_admin = false)
   OR used_by   IN (SELECT id FROM users WHERE is_admin = false);

-- 8) users — сами юзеры (кроме админа)
DELETE FROM users WHERE is_admin = false;

COMMIT;

-- Проверка: должен остаться только админ
SELECT id, telegram_id, first_name, is_admin, role, primary_role FROM users;
