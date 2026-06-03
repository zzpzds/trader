-- One-shot migration for the buy-sell-mechanism change.
-- Idempotent: safe to run multiple times.
-- Run BEFORE `docker compose --profile tools run --rm db-migrate` so
-- drizzle-kit push has no position_lots changes to prompt about.

BEGIN;

-- position_lots: add type column to distinguish BUY / SELL transactions.
-- BUY 行 cost_price=买入价;SELL 行 cost_price=卖出价。
ALTER TABLE position_lots
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'BUY';

COMMIT;
