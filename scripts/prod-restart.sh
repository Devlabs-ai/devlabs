#!/usr/bin/env bash
# Pull latest production images and recreate containers.
# Run from repo root: ./scripts/prod-restart.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f docker-compose.prod.yml ]]; then
  echo "docker-compose.prod.yml not found in $ROOT" >&2
  exit 1
fi

echo "==> pulling images"
docker compose -f docker-compose.prod.yml pull

echo "==> starting stack"
docker compose -f docker-compose.prod.yml up -d

echo "==> status"
docker compose -f docker-compose.prod.yml ps

echo "==> health"
curl -sf http://localhost/health && echo || echo "(health check failed — nginx/backend may still be starting)"
