#!/usr/bin/env bash
# =============================================================================
# FALLBACK DEPLOYMENT helper — primary mode is `docker compose up -d` on the
# server. Only use this when the server can't build the web image (OOM etc.).
# See docs/deploy.md and docker-compose.prebuilt.yml for context.
# =============================================================================
#
# Builds the Next.js web standalone bundle locally and packs it into a tarball
# small enough to upload via Aliyun Web Shell. Worker is NOT built here — it
# still builds on the server from git source.
#
# This script does its work in a persistent staging dir (./.deploy-staging/)
# so the host node_modules is never replaced with Linux x64 musl binaries —
# local `npm test` / `npm run dev` keeps working between deploys.
#
# Output: deploy-bundle/web/  (extracted bundle)
#         deploy-bundle/web.tar.gz  (upload this)
set -euo pipefail

cd "$(dirname "$0")/.."

STAGING="$(pwd)/.deploy-staging"
mkdir -p "$STAGING"

echo "==> [1/4] Syncing source to $STAGING (host node_modules untouched)"
rsync -a --delete \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='dist' \
  --exclude='deploy-bundle' \
  --exclude='.deploy-staging' \
  --exclude='.git' \
  --exclude='.env' \
  ./ "$STAGING/"

cd "$STAGING"

echo "==> [2/4] Installing target-platform deps (linux/amd64/musl) in staging"
# npm install is idempotent against package-lock; first run is slow, subsequent
# runs are fast unless package.json/lock changed.
npm install --cpu=x64 --os=linux --libc=musl --include=optional --ignore-scripts --no-audit --no-fund

echo "==> [3/4] Building packages/db + apps/web standalone"
npm run build -w packages/db
NEXT_SKIP_TYPE_CHECK=true NODE_OPTIONS="--max-old-space-size=512" \
  npm run build -w apps/web

echo "==> [4/4] Assembling deploy-bundle/web + tarball"
cd - >/dev/null
rm -rf deploy-bundle/web deploy-bundle/web.tar.gz
mkdir -p deploy-bundle/web

# Standalone already has a tree-shaken node_modules; overlay static + public.
cp -R "$STAGING/apps/web/.next/standalone/." deploy-bundle/web/
mkdir -p deploy-bundle/web/apps/web/.next
cp -R "$STAGING/apps/web/.next/static" deploy-bundle/web/apps/web/.next/static
cp -R "$STAGING/apps/web/public" deploy-bundle/web/apps/web/public

# tar.gz with deterministic layout (root entry = web/) for easy extraction
tar -czf deploy-bundle/web.tar.gz -C deploy-bundle web

echo
echo "✓ deploy-bundle/web/ ready ($(du -sh deploy-bundle/web | cut -f1))"
echo "✓ deploy-bundle/web.tar.gz ready ($(du -h deploy-bundle/web.tar.gz | cut -f1))"
echo
echo "Next steps:"
echo "  1. Upload deploy-bundle/web.tar.gz to the server via Aliyun Web Shell"
echo "  2. On the server (in Web Shell):"
echo "     cd /opt/trader"
echo "     git pull --ff-only"
echo "     mkdir -p deploy"
echo "     tar -xzf <uploaded path>/web.tar.gz -C deploy/"
echo "     docker compose -f docker-compose.yml -f docker-compose.prebuilt.yml up -d"
