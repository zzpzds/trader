## Why

The project currently deploys to Railway, which is expensive and adds latency for users in China. We need to deploy to an Alibaba Cloud Ubuntu server (2GB RAM) to reduce costs and improve access speed for the primary user base.

## What Changes

- Add a multi-stage, multi-target Dockerfile that builds web (Next.js standalone), worker, and db-migrate images from the monorepo
- Add docker-compose.yml to orchestrate postgres, web, worker, and db-migrate containers with memory limits tuned for 2GB RAM
- Add .dockerignore to exclude unnecessary files from Docker build context
- Enable Next.js `output: "standalone"` to reduce production image size from ~1GB to ~150MB
- Update .env.example to reference Docker Compose service names and add POSTGRES_PASSWORD
- Add .env to .gitignore to prevent secrets from being committed

## Capabilities

### New Capabilities
- `docker-deployment`: Containerized deployment via Docker Compose — includes Dockerfile, docker-compose.yml, .dockerignore, and environment configuration for running the full stack (PostgreSQL + web + worker) on a single server

### Modified Capabilities
<!-- No existing spec-level behavior changes — this is purely infrastructure -->

## Impact

- New files: Dockerfile, docker-compose.yml, .dockerignore (at project root)
- Modified files: apps/web/next.config.ts (add standalone output), .env.example (add POSTGRES_PASSWORD, update DATABASE_URL host), .gitignore (add .env)
- No application code changes — all environment differences handled via env vars
- railway.toml retained for reference, not removed
