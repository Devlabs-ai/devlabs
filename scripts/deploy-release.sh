#!/usr/bin/env bash
# Install one CI-built release on the app host. Run as root by the SSM document
# `devlabs-deploy` (infra/terraform/prod/app_instance.tf) from the extracted release
# bundle; not meant to be run from a laptop.
#
# Env (set by the SSM document):
#   APP_DIR       compose project on the host (holds .env, kube/, sandbox/)
#   RELEASE_SHA   commit SHA; images are tagged with it
#   ECR_REGISTRY  <account>.dkr.ecr.<region>.amazonaws.com
#   AWS_REGION
#
# Leaves APP_DIR/release.env pointing at the running images (prod-restart.sh reads it)
# and rolls back to the previous release.env if the new stack fails its health check.
set -euo pipefail

BUNDLE="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="${APP_DIR:?}"
RELEASE_SHA="${RELEASE_SHA:?}"
ECR_REGISTRY="${ECR_REGISTRY:?}"
AWS_REGION="${AWS_REGION:?}"
APP_USER="${APP_USER:-ec2-user}"
COMPOSE_FILE="docker-compose.prod.yml"
# Port 80 only redirects to HTTPS (a 301 would pass `curl -f`), so check the backend
# directly and the full nginx → backend path over TLS.
BACKEND_HEALTH_URL="${BACKEND_HEALTH_URL:-http://127.0.0.1:4000/health}"
PROXY_HEALTH_URL="${PROXY_HEALTH_URL:-https://localhost/health}"
HEALTH_TIMEOUT_S="${HEALTH_TIMEOUT_S:-120}"

[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "bad RELEASE_SHA: $RELEASE_SHA" >&2; exit 1; }
[[ -f "$APP_DIR/.env" ]] || { echo "$APP_DIR/.env missing; create it before the first deploy" >&2; exit 1; }

BACKEND_IMAGE="$ECR_REGISTRY/devlabs/backend:$RELEASE_SHA"
LAB_SHELL_IMAGE="$ECR_REGISTRY/devlabs/lab-shell:$RELEASE_SHA"

cd "$APP_DIR"
echo "==> release $RELEASE_SHA → $APP_DIR"

compose() {
  docker compose -f "$COMPOSE_FILE" "$@"
}

# shellcheck disable=SC1091
load_release_env() { set -a; source ./release.env; set +a; }

healthy() {
  local deadline=$(( SECONDS + HEALTH_TIMEOUT_S ))
  while (( SECONDS < deadline )); do
    if curl -fsS --max-time 5 "$BACKEND_HEALTH_URL" 2>/dev/null | grep -q '"ok":true' \
      && curl -fsSk --max-time 5 "$PROXY_HEALTH_URL" 2>/dev/null | grep -q '"ok":true'; then
      return 0
    fi
    sleep 3
  done
  return 1
}

echo "==> docker login $ECR_REGISTRY"
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$ECR_REGISTRY" >/dev/null

echo "==> pull images"
docker pull --quiet "$BACKEND_IMAGE"
docker pull --quiet "$LAB_SHELL_IMAGE"

echo "==> install compose file, nginx config, host scripts"
mkdir -p deploy/nginx scripts frontend/dist sandbox/verified kube/homes kube/learner kube/snapshots
# cp onto an existing file rewrites it in place, so single-file bind mounts
# (nginx config) keep pointing at the live file.
cp "$BUNDLE/$COMPOSE_FILE" "./$COMPOSE_FILE"
cp "$BUNDLE/deploy/nginx/devlabs.conf" deploy/nginx/devlabs.conf
cp "$BUNDLE/scripts/prod-restart.sh" "$BUNDLE/scripts/deploy-release.sh" scripts/
chmod +x scripts/*.sh

echo "==> install frontend build"
# frontend/dist is a directory bind mount: copy into it rather than replacing it.
# Hashed assets go first and old ones stay for a while, so open tabs keep loading
# chunks from the previous build; index.html switches last.
mkdir -p frontend/dist/assets
if [[ -d "$BUNDLE/frontend/dist/assets" ]]; then
  cp -r "$BUNDLE/frontend/dist/assets/." frontend/dist/assets/
fi
find "$BUNDLE/frontend/dist" -mindepth 1 -maxdepth 1 ! -name assets ! -name index.html \
  -exec cp -r {} frontend/dist/ \;
cp "$BUNDLE/frontend/dist/index.html" frontend/dist/index.html
find frontend/dist/assets -type f -mtime +14 -delete

chown -R "$APP_USER:$APP_USER" "$COMPOSE_FILE" deploy scripts frontend 2>/dev/null || true

[[ -f release.env ]] && cp release.env release.env.previous
cat > release.env <<EOF
# Written by scripts/deploy-release.sh; images of the running release.
DEVLABS_RELEASE_SHA=$RELEASE_SHA
DEVLABS_BACKEND_IMAGE=$ECR_REGISTRY/devlabs/backend
DEVLABS_BACKEND_TAG=$RELEASE_SHA
DEVLABS_LAB_SHELL_IMAGE=$LAB_SHELL_IMAGE
EOF
load_release_env

echo "==> start stack"
compose up -d --no-build
compose exec -T nginx nginx -t
compose exec -T nginx nginx -s reload

echo "==> health check ($BACKEND_HEALTH_URL, $PROXY_HEALTH_URL; ${HEALTH_TIMEOUT_S}s)"
if healthy; then
  echo "==> healthy: $RELEASE_SHA is live"
  compose ps
  docker image prune -f >/dev/null
  exit 0
fi

echo "!! health check failed for $RELEASE_SHA" >&2
compose logs --tail 100 backend >&2 || true
if [[ -f release.env.previous ]]; then
  echo "==> rolling back to previous release" >&2
  cp release.env.previous release.env
  load_release_env
  compose up -d --no-build
  if healthy; then
    echo "==> rollback healthy (${DEVLABS_RELEASE_SHA:-previous})" >&2
  else
    echo "!! rollback also unhealthy; investigate on the host" >&2
  fi
fi
exit 1
