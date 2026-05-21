#!/usr/bin/env bash
# Full production deploy on the EC2 host: sync git, rebuild frontend, pull images, up.
# Used by GitHub Actions CD and can be run manually:
#   DEPLOY_BRANCH=main ./scripts/prod-deploy.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BRANCH="${DEPLOY_BRANCH:-main}"

echo "==> git fetch + checkout ${BRANCH}"
git fetch origin
git checkout "$BRANCH"
git pull origin "$BRANCH"

if [[ -f frontend/package.json ]]; then
  echo "==> building frontend"
  cd frontend
  npm ci
  npm run build
  cd ..
fi

chmod +x scripts/prod-restart.sh
exec ./scripts/prod-restart.sh
