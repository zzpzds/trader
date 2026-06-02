-- One-shot migration for the manual-positions change.
-- Idempotent: safe to run multiple times.
-- Run BEFORE `docker compose --profile tools run --rm db-migrate` so
-- drizzle-kit push has no positions changes to prompt about.

BEGIN;

-- 1. strategies: add analysis_window_days (default 60)
ALTER TABLE strategies
  ADD COLUMN IF NOT EXISTS analysis_window_days integer NOT NULL DEFAULT 60;

-- 2. positions: drop NOT NULL on strategy_id; replace FK CASCADE → SET NULL
ALTER TABLE positions
  ALTER COLUMN strategy_id DROP NOT NULL;

ALTER TABLE positions
  DROP CONSTRAINT IF EXISTS positions_strategy_id_strategies_id_fk;

ALTER TABLE positions
  ADD CONSTRAINT positions_strategy_id_strategies_id_fk
  FOREIGN KEY (strategy_id) REFERENCES strategies(id) ON DELETE SET NULL;

-- 3. positions: replace unique INDEX with unique CONSTRAINT (NULLS NOT DISTINCT)
DROP INDEX IF EXISTS positions_strategy_id_symbol_idx;
ALTER TABLE positions
  DROP CONSTRAINT IF EXISTS positions_strategy_id_symbol_idx;

ALTER TABLE positions
  ADD CONSTRAINT positions_strategy_id_symbol_idx
  UNIQUE NULLS NOT DISTINCT (strategy_id, symbol);

-- 4. price_snapshots: new OHLCV time-series table
CREATE TABLE IF NOT EXISTS price_snapshots (
  symbol      TEXT NOT NULL,
  date        DATE NOT NULL,
  open        NUMERIC(15, 4) NOT NULL,
  high        NUMERIC(15, 4) NOT NULL,
  low         NUMERIC(15, 4) NOT NULL,
  close       NUMERIC(15, 4) NOT NULL,
  volume      BIGINT,
  fetched_at  TIMESTAMP NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, date)
);

CREATE INDEX IF NOT EXISTS price_snapshots_symbol_date_desc_idx
  ON price_snapshots (symbol, date DESC);

COMMIT;
