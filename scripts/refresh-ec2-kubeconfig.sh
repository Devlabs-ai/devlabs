#!/usr/bin/env bash
# Refresh App EC2 controller kubeconfig after EKS recreate (run from Mac).
#
# EC2 shell has no AWS creds (keys live in /opt/devlabs/.env for Docker only),
# so this refreshes kubeconfig on the Mac and scp's it to the host, then
# recreates the backend so the process-cached cluster endpoint is cleared.
#
# Usage (repo root):
#   EC2_HOST=18.61.188.116 EC2_KEY=./.devlabs-beta.pem ./scripts/refresh-ec2-kubeconfig.sh
#   EC2_HOST=… ./scripts/refresh-ec2-kubeconfig.sh --no-recreate   # kubeconfig only
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

RECREATE_BACKEND=1
for arg in "$@"; do
  case "$arg" in
    --no-recreate) RECREATE_BACKEND=0 ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *)
      echo "unknown arg: $arg (try --no-recreate)" >&2
      exit 1
      ;;
  esac
done

# shellcheck source=../deploy/eks/env.sh
source "$ROOT/deploy/eks/env.sh"

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
REMOTE_KUBE="${EC2_KUBECONFIG_PATH:-${REMOTE_DIR}/kube/k8s-lab.kubeconfig}"
LOCAL_KUBE="${EKS_KUBECONFIG_OUT:-${ROOT}/kube/k8s-lab.kubeconfig}"
# Resolve relative local path from repo root
if [[ "$LOCAL_KUBE" != /* ]]; then
  LOCAL_KUBE="$ROOT/$LOCAL_KUBE"
fi

if [[ ! -f "$KEY" ]]; then
  echo "SSH key not found: $KEY" >&2
  echo "Set EC2_KEY to your .pem path." >&2
  exit 1
fi
if ! command -v aws >/dev/null 2>&1; then
  echo "aws CLI not found (needed on Mac to refresh kubeconfig)" >&2
  exit 1
fi

chmod 400 "$KEY" 2>/dev/null || true
SSH=(ssh -i "$KEY" -o StrictHostKeyChecking=accept-new)
SCP=(scp -i "$KEY" -o StrictHostKeyChecking=accept-new)

if ! aws eks describe-cluster \
  --name "$EKS_CLUSTER_NAME" \
  --region "$AWS_REGION" >/dev/null 2>&1; then
  echo "cluster $EKS_CLUSTER_NAME not found in $AWS_REGION (recreate first?)" >&2
  exit 1
fi

mkdir -p "$(dirname "$LOCAL_KUBE")"
echo "==> refresh local kubeconfig → $LOCAL_KUBE"
aws eks update-kubeconfig \
  --name "$EKS_CLUSTER_NAME" \
  --region "$AWS_REGION" \
  --kubeconfig "$LOCAL_KUBE"
chmod 600 "$LOCAL_KUBE" 2>/dev/null || true

SERVER="$(grep -E '^\s*server:' "$LOCAL_KUBE" | head -1 | awk '{print $2}')"
echo "    server: $SERVER"

echo "==> ensure remote dir $(dirname "$REMOTE_KUBE")"
"${SSH[@]}" "${USER_NAME}@${HOST}" \
  "mkdir -p '$(dirname "$REMOTE_KUBE")' && if [[ -f '$REMOTE_KUBE' ]]; then cp -a '$REMOTE_KUBE' '${REMOTE_KUBE}.bak'; fi"

echo "==> scp kubeconfig → ${USER_NAME}@${HOST}:${REMOTE_KUBE}"
"${SCP[@]}" "$LOCAL_KUBE" "${USER_NAME}@${HOST}:${REMOTE_KUBE}"
"${SSH[@]}" "${USER_NAME}@${HOST}" "chmod 600 '$REMOTE_KUBE'"

echo "==> verify remote server line"
"${SSH[@]}" "${USER_NAME}@${HOST}" "grep -E '^\s*server:' '$REMOTE_KUBE'"

if [[ "$RECREATE_BACKEND" -eq 1 ]]; then
  echo "==> recreate backend (clear process-cached EKS endpoint)"
  "${SSH[@]}" "${USER_NAME}@${HOST}" \
    "cd '$REMOTE_DIR' && docker compose -f docker-compose.prod.yml up -d --force-recreate backend"
else
  echo "==> skipped backend recreate (--no-recreate)"
  echo "    run when ready:"
  echo "    ssh -i $KEY ${USER_NAME}@${HOST} 'cd $REMOTE_DIR && docker compose -f docker-compose.prod.yml up -d --force-recreate backend'"
fi

echo "==> done"
