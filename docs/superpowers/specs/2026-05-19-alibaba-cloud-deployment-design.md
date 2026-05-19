# Alibaba Cloud Ubuntu Deployment Design

Migrate the trader project from Railway to Alibaba Cloud Ubuntu server using Docker Compose.

## Context

- Server: Alibaba Cloud Ubuntu, 2GB RAM
- No domain, IP-only access
- Manual deployment (no CI/CD)
- Self-hosted PostgreSQL in Docker
- Project: monorepo with apps/web (Next.js 16), apps/worker (pg-boss), packages/db (Drizzle ORM)

## Files to Create

### Dockerfile (root)

Multi-stage, multi-target single Dockerfile:

```
Stage 1 — base: node:20-alpine, install all workspace dependencies
Stage 2 — build: build @trader/db first, then web (standalone) and worker
Target web: copy .next/standalone + .next/static + public
Target worker: copy dist/ + production node_modules
Target db-migrate: copy packages/db + drizzle-kit, entrypoint is drizzle-kit push
```

Key decisions:
- Single Dockerfile because monorepo shares dependency install step
- Next.js standalone output reduces image from ~1GB to ~150MB
- Alpine base image (~50MB) vs full (~350MB)
- db package must be built before web and worker

### docker-compose.yml

```yaml
services:
  postgres:
    image: postgres:16-alpine
    volumes: [pgdata:/var/lib/postgresql/data]
    environment:
      POSTGRES_DB: trader
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    mem_limit: 512m
    command: >
      postgres
      -c shared_buffers=128MB
      -c work_mem=4MB
      -c effective_cache_size=256MB

  web:
    build:
      context: .
      target: web
    ports: ["3000:3000"]
    depends_on: [postgres]
    environment:
      DATABASE_URL: postgresql://postgres:${POSTGRES_PASSWORD}@postgres:5432/trader
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
      ANTHROPIC_BASE_URL: ${ANTHROPIC_BASE_URL}
    mem_limit: 512m
    command: node --max-old-space-size=256 server.js

  worker:
    build:
      context: .
      target: worker
    depends_on: [postgres]
    environment:
      DATABASE_URL: postgresql://postgres:${POSTGRES_PASSWORD}@postgres:5432/trader
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
      ANTHROPIC_BASE_URL: ${ANTHROPIC_BASE_URL}
    mem_limit: 384m
    command: node --max-old-space-size=192 dist/index.js

  db-migrate:
    build:
      context: .
      target: db-migrate
    depends_on: [postgres]
    environment:
      DATABASE_URL: postgresql://postgres:${POSTGRES_PASSWORD}@postgres:5432/trader
    profiles: ["tools"]

volumes:
  pgdata:
```

### .dockerignore

```
node_modules
.git
.next
dist
.env
*.md
docs
openspec
.claude
.superpowers
.playwright-cli
```

## Files to Modify

### next.config.ts

Add `output: "standalone"` to enable Next.js standalone build output. This produces a minimal server bundle in `.next/standalone/` that doesn't require the full node_modules.

### .env.example

Update DATABASE_URL example to use Docker Compose service name:

```
DATABASE_URL=postgresql://postgres:password@postgres:5432/trader
POSTGRES_PASSWORD=password
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_BASE_URL=https://qianfan.baidubce.com/anthropic/coding
```

## Memory Optimization (2GB Server)

| Component | Memory Limit | Tuning |
|-----------|-------------|--------|
| PostgreSQL | 512MB | shared_buffers=128MB, work_mem=4MB |
| Web (Next.js) | 512MB | --max-old-space-size=256 |
| Worker | 384MB | --max-old-space-size=192 |
| OS + Docker | ~600MB | — |

## Deployment Procedure

### First-time Setup

```bash
# 1. Install Docker
apt update && apt install -y docker.io docker-compose-plugin

# 2. Clone project
git clone <repo-url> /opt/trader && cd /opt/trader

# 3. Configure environment
cp .env.example .env
# Edit .env with real values

# 4. Build and start
docker compose up -d --build

# 5. Initialize database schema
docker compose run --rm db-migrate
```

### Updates

```bash
cd /opt/trader
git pull
docker compose up -d --build
```

### Database Backup

```bash
docker compose exec postgres pg_dump -U postgres trader > backup.sql
```

### Logs

```bash
docker compose logs -f web
docker compose logs -f worker
```

## What Stays Unchanged

- `railway.toml` — kept for reference, doesn't affect Docker deployment
- Application code — all environment differences handled via env vars
- Worker SIGTERM/SIGINT handlers — already Docker-compatible

## Firewall

Open port 3000 for web access.
