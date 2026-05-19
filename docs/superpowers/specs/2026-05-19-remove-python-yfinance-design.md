# Replace Python yfinance with Node.js yahoo-finance2

## Goal

Remove the Python runtime dependency from the worker app by replacing the `yfinance`-based price fetcher with the `yahoo-finance2` npm package.

## Context

The worker currently spawns a Python subprocess (`yahoo_fetch.py`) to fetch stock prices via the `yfinance` library. This requires Python 3 + yfinance + pandas to be installed at runtime. The rest of the project is entirely Node.js/TypeScript, making Python the sole non-Node dependency.

## Design

### Interface (unchanged)

`fetchPrices(symbols: string[], period?: string): Promise<FetchResult>` keeps the same signature and return types (`FetchResult`, `PriceData`). No changes needed in `job.ts`, `analyze.ts`, or any other consumer.

### Implementation

Replace `yahoo-fetch.ts` with a direct `yahoo-finance2` call:

- Use `yahooFinance.chart(symbol, { period1, period2 })` to get historical OHLCV data
- Map the `chart.quotes` array to the existing `PriceData` shape
- Filter out quotes with null close prices
- Convert period string (e.g. `"60d"`) to a start date for `period1`
- Errors from yahoo-finance2 propagate naturally (no special wrapping needed)

### Error Handling

- `yahoo-finance2` throws on invalid symbols, network errors, etc. — these bubble up to `job.ts` which already has try/catch
- No behavior change at the monitoring job level

### Cleanup

Delete these files:
- `apps/worker/yahoo_fetch.py`
- `requirements.txt` (root — contains akshare + pandas, both unused in practice)

### Dependencies

Add to `apps/worker/package.json`:
- `yahoo-finance2`: ^3.14.1

### Tests

Rewrite `apps/worker/src/monitoring/__tests__/yahoo-fetch.test.ts`:
- Mock `yahoo-finance2` module instead of `child_process.spawn`
- Test cases remain the same: success, no data, invalid response

## Out of Scope

- Changing the `FetchResult` / `PriceData` interface
- Modifying `job.ts`, `analyze.ts`, or the web app
- Adding A-share or other market data sources
- Rate limiting or caching (current design has none; can add later if needed)
