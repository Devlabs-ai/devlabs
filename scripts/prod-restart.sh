#!/usr/bin/env bash
# Pull the current release's images and recreate containers.
# Run from repo root on the host: ./scripts/prod-restart.sh
# Image refs come from release.env (written by scripts/deploy-release.sh) when present.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f docker-compose.prod.yml ]]; then
  echo "docker-compose.prod.yml not found in $ROOT" >&2
  exit 1
fi

if [[ -f release.env ]]; then
  set -a
  # shellcheck disable=SC1091
  source ./release.env
  set +a
  # Pinned SHA tags were already pulled by deploy-release.sh (and pulling from ECR
  # needs a login only root has).
  echo "==> release ${DEVLABS_RELEASE_SHA:-unknown}"
else
  echo "==> pulling images"
  docker compose -f docker-compose.prod.yml pull backend
fi

echo "==> starting stack"
docker compose -f docker-compose.prod.yml up -d --no-build

echo "==> status"
docker compose -f docker-compose.prod.yml ps

echo "==> health"
curl -sfk https://localhost/health && echo || echo "(health check failed — nginx/backend may still be starting)"
