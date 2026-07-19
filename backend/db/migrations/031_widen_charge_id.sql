-- 031_widen_charge_id.sql
-- Hotfix 7.5: telegram_payment_charge_id VARCHAR(128) too small for real Telegram Stars
-- charge_id → mark-paid fails 22001, webhook 500, Telegram retries update forever.
-- Widen to TEXT. Idempotent (TYPE TEXT no-op if already text). UNIQUE constraint preserved automatically.
ALTER TABLE payments ALTER COLUMN telegram_payment_charge_id TYPE TEXT;
