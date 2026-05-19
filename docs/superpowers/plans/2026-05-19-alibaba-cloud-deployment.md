# Alibaba Cloud Docker Compose Deployment Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Containerize the trader monorepo and deploy it to an Alibaba Cloud Ubuntu server using Docker Compose with self-hosted PostgreSQL.

**Architecture:** Single multi-target Dockerfile builds all three services (web, worker, db-migrate). Docker Compose orchestrates postgres, web, and worker containers with memory limits tuned for a 2GB server. Next.js standalone output minimizes image size.

**Tech Stack:** Docker, Docker Compose, Node.js 20 Alpine, PostgreSQL 16 Alpine, Next.js 16 standalone, Drizzle Kit

---

### Task 1: Create .dockerignore

**Files:**
- Create: `.dockerignore`

- [ ] **Step 1: Create .dockerignore file**

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

- [ ] **Step 2: Commit**

```bash
git add .dockerignore
git commit -m "chore: add .dockerignore for Docker build"
```

---

### Task 2: Modify next.config.ts for standalone output

**Files:**
- Modify: `apps/web/next.config.ts`

- [ ] **Step 1: Add standalone output mode**

Change `apps/web/next.config.ts` to:

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
};

export default nextConfig;
```

- [ ] **Step 2: Verify Next.js build still works locally**

Run: `npm run build -w apps/web`
Expected: Build succeeds. Check that `apps/web/.next/standalone/` directory exists.

- [ ] **Step 3: Commit**

```bash
git add apps/web/next.config.ts
git commit -m "feat(web): enable standalone output for Docker deployment"
```

---

### Task 3: Create Dockerfile

**Files:**
- Create: `Dockerfile`

- [ ] **Step 1: Create multi-stage, multi-target Dockerfile**

```dockerfile
# ---- Base: install dependencies ----
FROM node:20-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/db/package.json packages/db/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
RUN npm ci --ignore-scripts

# ---- Build: compile all workspaces ----
FROM base AS build
COPY . .
RUN npm run build -w packages/db
RUN npm run build -w apps/web
RUN npm run build -w apps/worker

# ---- Web target: Next.js standalone ----
FROM node:20-alpine AS web
WORKDIR /app
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

# ---- Worker target ----
FROM node:20-alpine AS worker
WORKDIR /app
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=build /app/packages/db/dist ./packages/db/dist
WORKDIR /app/apps/worker
CMD ["node", "dist/index.js"]

# ---- DB migrate target ----
FROM base AS db-migrate
COPY . .
RUN npm run build -w packages/db
WORKDIR /app/packages/db
CMD ["npx", "drizzle-kit", "push"]
```

- [ ] **Step 2: Test Docker build for web target**

Run: `docker build --target web -t trader-web .`
Expected: Build succeeds without errors.

- [ ] **Step 3: Test Docker build for worker target**

Run: `docker build --target worker -t trader-worker .`
Expected: Build succeeds without errors.

- [ ] **Step 4: Test Docker build for db-migrate target**

Run: `docker build --target db-migrate -t trader-db-migrate .`
Expected: Build succeeds without errors.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile
git commit -m "feat: add multi-stage Dockerfile with web/worker/db-migrate targets"
```

---

### Task 4: Create docker-compose.yml

**Files:**
- Create: `docker-compose.yml`

- [ ] **Step 1: Create docker-compose.yml**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    volumes:
      - pgdata:/var/lib/postgresql/data
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
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d trader"]
      interval: 5s
      timeout: 5s
      retries: 5

  web:
    build:
      context: .
      target: web
    ports:
      - "3000:3000"
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://postgres:${POSTGRES_PASSWORD}@postgres:5432/trader
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
      ANTHROPIC_BASE_URL: ${ANTHROPIC_BASE_URL}
    mem_limit: 512m
    command: node --max-old-space-size=256 apps/web/server.js

  worker:
    build:
      context: .
      target: worker
    depends_on:
      postgres:
        condition: service_healthy
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
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://postgres:${POSTGRES_PASSWORD}@postgres:5432/trader
    profiles:
      - tools

volumes:
  pgdata:
```

- [ ] **Step 2: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: add docker-compose.yml with postgres/web/worker/db-migrate services"
```

---

### Task 5: Update .env.example

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Update .env.example with Docker Compose service name and POSTGRES_PASSWORD**

Replace the contents of `.env.example` with:

```
DATABASE_URL=postgresql://postgres:password@postgres:5432/trader
POSTGRES_PASSWORD=password
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_BASE_URL=https://qianfan.baidubce.com/anthropic/coding
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "chore: update .env.example for Docker Compose deployment"
```

---

### Task 6: End-to-end smoke test

**Files:** None (verification only)

This task verifies the full stack starts up correctly in Docker Compose.

- [ ] **Step 1: Create a test .env file for local Docker testing**

Create a temporary `.env` file (do not commit) with real values for local Docker Compose testing:

```bash
cp .env.example .env
# Edit .env to set a real POSTGRES_PASSWORD and ANTHROPIC_API_KEY
```

- [ ] **Step 2: Start the stack**

Run: `docker compose up -d --build`
Expected: All three services (postgres, web, worker) start. db-migrate is skipped (tools profile).

- [ ] **Step 3: Run database migration**

Run: `docker compose run --rm db-migrate`
Expected: Drizzle Kit pushes schema and exits successfully.

- [ ] **Step 4: Verify web is accessible**

Run: `curl http://localhost:3000`
Expected: Returns HTML response (status 200).

- [ ] **Step 5: Verify worker is running**

Run: `docker compose logs worker | tail -5`
Expected: Log shows "[worker] started, daily-monitoring cron registered".

- [ ] **Step 6: Verify PostgreSQL connectivity**

Run: `docker compose exec postgres pg_isready -U postgres -d trader`
Expected: "accepting connections".

- [ ] **Step 7: Clean up**

Run: `docker compose down`
(Do NOT run `docker compose down -v` as that would delete the volume — keep pgdata for future use.)

---

### Task 7: Update .gitignore for Docker artifacts

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Add Docker-related entries to .gitignore**

Append to `.gitignore`:

```
# Docker
.env
```

Note: `.env` is not currently in `.gitignore` and should be excluded from version control since it contains secrets.

- [ ] **Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: add .env to .gitignore for Docker deployment"
```
