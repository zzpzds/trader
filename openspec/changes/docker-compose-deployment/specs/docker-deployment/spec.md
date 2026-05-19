## ADDED Requirements

### Requirement: Docker image builds for all services
The system SHALL provide a multi-stage Dockerfile at the project root that produces three build targets: `web`, `worker`, and `db-migrate`. The Dockerfile SHALL use node:20-alpine as the base image and install dependencies via `npm ci`.

#### Scenario: Web target builds successfully
- **WHEN** `docker build --target web -t trader-web .` is executed from the project root
- **THEN** the build completes without errors and produces an image containing the Next.js standalone server bundle at `apps/web/server.js`

#### Scenario: Worker target builds successfully
- **WHEN** `docker build --target worker -t trader-worker .` is executed from the project root
- **THEN** the build completes without errors and produces an image containing the compiled worker at `apps/worker/dist/index.js`

#### Scenario: DB migrate target builds successfully
- **WHEN** `docker build --target db-migrate -t trader-db-migrate .` is executed from the project root
- **THEN** the build completes without errors and produces an image that can run `drizzle-kit push`

### Requirement: Docker Compose orchestrates all services
The system SHALL provide a `docker-compose.yml` that defines four services: `postgres`, `web`, `worker`, and `db-migrate`. The `postgres` service SHALL use the postgres:16-alpine image with a persistent volume. The `web` and `worker` services SHALL depend on `postgres` being healthy before starting.

#### Scenario: Full stack starts with docker compose up
- **WHEN** `docker compose up -d --build` is executed with a valid `.env` file
- **THEN** postgres, web, and worker containers start successfully; the db-migrate service does NOT start (it is in the `tools` profile)

#### Scenario: Web is accessible after startup
- **WHEN** all services are running
- **THEN** `curl http://localhost:3000` returns HTTP 200

#### Scenario: Worker connects to PostgreSQL
- **WHEN** the worker container starts
- **THEN** the worker log shows `[worker] started, daily-monitoring cron registered`

### Requirement: PostgreSQL data persistence
The system SHALL persist PostgreSQL data in a Docker named volume `pgdata`. Data SHALL survive `docker compose down` and be available after `docker compose up`.

#### Scenario: Data survives container restart
- **WHEN** `docker compose down` followed by `docker compose up -d` is executed
- **THEN** previously stored data (strategies, positions, etc.) remains intact

### Requirement: Database schema migration
The system SHALL provide a `db-migrate` service that runs `drizzle-kit push` to create or update the database schema. The service SHALL use the `tools` profile so it does not start automatically.

#### Scenario: Schema migration runs successfully
- **WHEN** `docker compose run --rm db-migrate` is executed
- **THEN** drizzle-kit pushes the schema to PostgreSQL and exits with code 0

### Requirement: Memory limits for 2GB server
The system SHALL set `mem_limit` on all services: postgres at 512m, web at 512m, worker at 384m. PostgreSQL SHALL be configured with `shared_buffers=128MB`, `work_mem=4MB`, `effective_cache_size=256MB`. Node.js processes SHALL use `--max-old-space-size` flags (web: 256, worker: 192).

#### Scenario: Containers respect memory limits
- **WHEN** all services are running under load
- **THEN** no container exceeds its memory limit (verified via `docker stats`)

### Requirement: Docker build context exclusion
The system SHALL include a `.dockerignore` file that excludes node_modules, .git, .next, dist, .env, docs, openspec, .claude, .superpowers, and .playwright-cli from the Docker build context.

#### Scenario: Build context excludes unnecessary files
- **WHEN** `docker build` is executed
- **THEN** the build context does not include node_modules, .git, .env, or other excluded paths

### Requirement: Environment variable configuration
The system SHALL use `.env` file for all secrets and configuration. The `.env.example` file SHALL document required variables: DATABASE_URL, POSTGRES_PASSWORD, ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL. The DATABASE_URL host SHALL be `postgres` (the Docker Compose service name). The `.env` file SHALL be listed in `.gitignore`.

#### Scenario: Environment variables are injected into containers
- **WHEN** a `.env` file exists at the project root with all required variables
- **THEN** all services receive the correct values via Docker Compose variable substitution

### Requirement: Next.js standalone output
The web app SHALL use `output: "standalone"` in next.config.ts to produce a minimal production server bundle that does not require the full node_modules directory.

#### Scenario: Standalone build produces minimal bundle
- **WHEN** `npm run build -w apps/web` is executed
- **THEN** the `.next/standalone/` directory is created with only production dependencies
