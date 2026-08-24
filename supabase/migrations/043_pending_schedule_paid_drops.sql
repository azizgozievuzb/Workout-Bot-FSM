-- S64-13 «Смена графика v2»: кулдаун 30д умирает, pending можно отменить с полным
-- возвратом уплаченного. Возврат обязан равняться ФАКТИЧЕСКИ уплаченному, а цена в
-- app_shop_items может измениться между покупкой и отменой → храним цену в момент покупки.
-- Ставится при покупке смены, очищается при отмене и при применении pending (джоба).
ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_schedule_paid_drops INTEGER NULL;
COMMENT ON COLUMN users.pending_schedule_paid_drops IS
  'Капли, уплаченные за текущую заявку смены графика (pending_main_days). NULL = заявки нет / уже применена.';
