## Context

The trader project is a Node.js monorepo (npm workspaces) with three packages: apps/web (Next.js 16), apps/worker (pg-boss background jobs), and packages/db (Drizzle ORM schema). It currently deploys to Railway via `railway.toml`, using Railway's managed PostgreSQL. The target is an Alibaba Cloud Ubuntu server with 2GB RAM, no domain, IP-only access, and manual deployment.

## Goals / Non-Goals

**Goals:**
- Run the full stack (PostgreSQL + web + worker) on a single 2GB server via Docker Compose
- Minimize Docker image sizes through Next.js standalone output and Alpine base images
- Provide a one-command startup: `docker compose up -d`
- Persist PostgreSQL data across container restarts via Docker volumes
- Enable schema migration via a one-shot `db-migrate` container

**Non-Goals:**
- CI/CD pipeline (manual deployment is sufficient for now)
- HTTPS / domain configuration (IP-only access)
- Horizontal scaling or Kubernetes
- Removing Railway support (railway.toml is retained)

## Decisions

### 1. Single multi-target Dockerfile vs multiple Dockerfiles

**Chosen: Single multi-target Dockerfile.**

The monorepo shares a single `npm ci` step across all workspaces. A single Dockerfile with `--target` flags avoids duplicating the dependency installation layer. Alternatives: one Dockerfile per app (wastes ~200MB of repeated deps), or a shared base image (adds complexity for this scale).

### 2. Next.js standalone output

**Chosen: Enable `output: "standalone"`.**

Standalone mode produces a minimal server bundle in `.next/standalone/` that includes only production dependencies. Image size drops from ~1GB (full node_modules) to ~150MB. The tradeoff is that `server.js` path becomes `apps/web/server.js` inside the standalone directory (preserves monorepo directory structure).

### 3. Alpine vs full Node.js image

**Chosen: node:20-alpine.**

Alpine is ~50MB vs ~350MB for the full image. No native dependencies are used that would require glibc, so Alpine is safe. The postgres image also uses Alpine.

### 4. PostgreSQL memory tuning for 2GB server

**Chosen: shared_buffers=128MB, work_mem=4MB, effective_cache_size=256MB.**

With only 2GB total, PostgreSQL cannot use the default settings effectively. These values allocate ~512MB to PG (including connections and work memory), leaving room for web (512MB limit), worker (384MB limit), and the OS (~600MB).

### 5. Database migration strategy

**Chosen: Dedicated `db-migrate` container in the `tools` profile.**

Using `docker compose run --rm db-migrate` keeps migration separate from the main services. It runs `drizzle-kit push` which is idempotent. The `tools` profile ensures it doesn't start with `docker compose up`. Alternative: init script in the postgres container (fragile, harder to debug).

### 6. Container startup ordering

**Chosen: PostgreSQL healthcheck + `depends_on: condition: service_healthy`.**

pg-boss and the web app will crash if PostgreSQL is unavailable. The healthcheck using `pg_isready` ensures web and worker only start after PG is accepting connections. Alternative: retry logic in application code (adds complexity for no benefit at this scale).

## Risks / Trade-offs

- **[2GB memory limit]** → Each container has `mem_limit` and Node `--max-old-space-size` to prevent OOM kills. If the worker's monitoring job processes many strategies concurrently, `CONCURRENCY_LIMIT=3` in the code already caps parallelism.
- **[Standalone path quirk]** → Next.js standalone preserves the monorepo directory structure, so `server.js` is at `apps/web/server.js` not just `server.js`. The Dockerfile and compose file must use the full relative path.
- **[Docker build disk usage]** → Building all three targets requires ~1-2GB of disk. On a small server, `docker system prune` may be needed periodically.
- **[No automated backups]** → Database backup is manual via `pg_dump`. Could be automated with a cron container later, but out of scope for now.
