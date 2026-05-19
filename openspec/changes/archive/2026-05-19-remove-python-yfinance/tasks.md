# Tasks: Remove Python yfinance

## Completed

- [x] Install yahoo-finance2 npm package in worker workspace
- [x] Rewrite `apps/worker/src/monitoring/yahoo-fetch.ts` to use yahoo-finance2 instead of Python subprocess
- [x] Rewrite `apps/worker/src/monitoring/__tests__/yahoo-fetch.test.ts` to mock yahoo-finance2
- [x] Run full test suite — all 32 tests pass across db/web/worker
- [x] Delete `apps/worker/yahoo_fetch.py`
- [x] Delete root `requirements.txt`
- [x] Remove stale `apps/worker/dist/` directory
- [x] Verify no Python references remain in source code
