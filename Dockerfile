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
ENV NEXT_SKIP_TYPE_CHECK=true
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
COPY --from=build /app/packages/db ./packages/db
WORKDIR /app/apps/worker
CMD ["node", "dist/index.js"]

# ---- DB migrate target ----
FROM base AS db-migrate
COPY . .
RUN npm run build -w packages/db
WORKDIR /app/packages/db
CMD ["npx", "drizzle-kit", "push"]
