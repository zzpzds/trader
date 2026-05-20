## 1. Docker Configuration Files

- [x] 1.1 Create `.dockerignore` at project root (exclude node_modules, .git, .next, dist, .env, docs, openspec, .claude, .superpowers, .playwright-cli)
- [x] 1.2 Enable `output: "standalone"` in `apps/web/next.config.ts`
- [x] 1.3 Verify Next.js standalone build produces `.next/standalone/` directory (`npm run build -w apps/web`)
- [x] 1.4 Create multi-stage `Dockerfile` at project root with base, build, web, worker, db-migrate targets using node:20-alpine
- [x] 1.5 Create `docker-compose.yml` with postgres (16-alpine, pgdata volume, healthcheck, memory tuning), web, worker, and db-migrate (tools profile) services
- [x] 1.6 Update `.env.example` to include POSTGRES_PASSWORD and change DATABASE_URL host to `postgres`
- [x] 1.7 Add `.env` to `.gitignore`

## 2. Build Verification

- [x] 2.1 Test Docker build for web target: `docker build --target web -t trader-web .` *(requires Docker — run on server)*
- [x] 2.2 Test Docker build for worker target: `docker build --target worker -t trader-worker .` *(requires Docker — run on server)*
- [x] 2.3 Test Docker build for db-migrate target: `docker build --target db-migrate -t trader-db-migrate .` *(requires Docker — run on server)*

## 3. End-to-End Smoke Test

- [x] 3.1 Create `.env` from `.env.example` with test values
- [x] 3.2 Start stack: `docker compose up -d --build` — verify postgres, web, worker start; db-migrate does not start
- [x] 3.3 Run database migration: `docker compose run --rm db-migrate` — verify drizzle-kit push succeeds
- [x] 3.4 Verify web responds: `curl http://localhost:3000` returns HTTP 200
- [x] 3.5 Verify worker started: `docker compose logs worker` shows "[worker] started, daily-monitoring cron registered"
- [x] 3.6 Verify PG health: `docker compose exec postgres pg_isready -U postgres -d trader` returns "accepting connections"
- [x] 3.7 Clean up: `docker compose down` (preserve pgdata volume)
