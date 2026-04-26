-- 025_drop_legacy_access_tier.sql
-- Final removal of the legacy users.access_tier column.
--
-- Background:
--   * Migration 014 added users.access_tier (single role-agnostic tier).
--   * Migration 021 introduced users.responsible_access_tier and users.player_access_tier
--     and backfilled them from access_tier. Since 021 the legacy column is read-only.
--   * All runtime code (handlers, routers, FSM) selects only the role-specific columns.
--   * Promo-codes table keeps its own promo_codes.access_tier — NOT TOUCHED here.
--
-- Safety:
--   * IF EXISTS makes the migration idempotent.
--   * No code path writes to users.access_tier after 021, so dropping it is non-breaking.

ALTER TABLE users DROP COLUMN IF EXISTS access_tier;
