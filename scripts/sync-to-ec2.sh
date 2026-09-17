#!/usr/bin/env bash
# Sync Lean Beta app files to the EC2 host (no CI/CD).
#
# Usage (from repo root on your Mac):
#   EC2_HOST=18.61.188.116 EC2_KEY=./.devlabs-beta.pem ./scripts/sync-to-ec2.sh
#   EC2_HOST=… EC2_KEY=… ./scripts/sync-to-ec2.sh --with-kubeconfig
#
# --with-kubeconfig also refreshes EKS kubeconfig on the remote host and
# recreates the backend (see scripts/refresh-ec2-kubeconfig.sh).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

WITH_KUBECONFIG=0
for arg in "$@"; do
  case "$arg" in
    --with-kubeconfig|--refresh-kubeconfig) WITH_KUBECONFIG=1 ;;
    -h|--help)
      sed -n '2,11p' "$0"
      exit 0
      ;;
    *)
      echo "unknown arg: $arg (try --with-kubeconfig)" >&2
      exit 1
      ;;
  esac
done

HOST="${EC2_HOST:?set EC2_HOST (Elastic IP)}"
if [[ -n "${EC2_KEY:-}" ]]; then
  KEY="$EC2_KEY"
elif [[ -f "$ROOT/.devlabs-beta.pem" ]]; then
  KEY="$ROOT/.devlabs-beta.pem"
else
  KEY="${HOME}/Downloads/devlabs-beta.pem"
fi
USER_NAME="${EC2_USER:-ec2-user}"
REMOTE_DIR="${EC2_APP_DIR:-/opt/devlabs}"

if [[ ! -f "$KEY" ]]; then
  echo "SSH key not found: $KEY" >&2
  echo "Set EC2_KEY to your .pem path." >&2
  exit 1
fi

chmod 400 "$KEY" 2>/dev/null || true

echo "==> ensure remote dir $REMOTE_DIR"
ssh -i "$KEY" -o StrictHostKeyChecking=accept-new \
  "${USER_NAME}@${HOST}" \
  "sudo mkdir -p '$REMOTE_DIR' && sudo chown ${USER_NAME}:${USER_NAME} '$REMOTE_DIR' && mkdir -p '$REMOTE_DIR/sandbox/verified' '$REMOTE_DIR/kube/homes'"

echo "==> rsync app files → ${USER_NAME}@${HOST}:${REMOTE_DIR}"
# Only the trees needed to build frontend + backend image and run compose.
rsync -avz --delete \
  -e "ssh -i \"$KEY\" -o StrictHostKeyChecking=accept-new" \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --exclude '**/node_modules/' \
  --exclude 'backend/dist/' \
  --exclude 'frontend/dist/' \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude 'sandbox/sessions/' \
  --exclude 'sandbox/builds/' \
  --exclude '**/.DS_Store' \
  --exclude '.cursor/' \
  \
  ./docker-compose.prod.yml \
  ./deploy \
  ./backend \
  ./frontend \
  ./scripts \
  "${USER_NAME}@${HOST}:${REMOTE_DIR}/"

# sandbox/verified may be empty locally; keep remote dir present
rsync -avz \
  -e "ssh -i $KEY -o StrictHostKeyChecking=accept-new" \
  --exclude '.DS_Store' \
  ./sandbox/verified/ \
  "${USER_NAME}@${HOST}:${REMOTE_DIR}/sandbox/verified/" 2>/dev/null \
  || ssh -i "$KEY" "${USER_NAME}@${HOST}" "mkdir -p '${REMOTE_DIR}/sandbox/verified'"

echo "==> sync done"

if [[ "$WITH_KUBECONFIG" -eq 1 ]]; then
  echo ""
  EC2_HOST="$HOST" EC2_KEY="$KEY" EC2_USER="$USER_NAME" EC2_APP_DIR="$REMOTE_DIR" \
    "$ROOT/scripts/refresh-ec2-kubeconfig.sh"
else
  echo "Next (optional):"
  echo "  # refresh EKS kubeconfig on EC2 + recreate backend"
  echo "  EC2_HOST=$HOST EC2_KEY=$KEY ./scripts/refresh-ec2-kubeconfig.sh"
  echo "  # or re-run sync with:  ./scripts/sync-to-ec2.sh --with-kubeconfig"
  echo ""
  echo "On the instance (first-time / code deploy):"
  echo "  ssh -i $KEY ${USER_NAME}@${HOST}"
  echo "  cd $REMOTE_DIR"
  echo "  # keep existing .env — do not overwrite"
  echo "  cd frontend && npm ci && npm run build && cd .."
  echo "  docker compose -f docker-compose.prod.yml build backend"
  echo "  docker compose -f docker-compose.prod.yml up -d"
fi
