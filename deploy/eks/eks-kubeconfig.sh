#!/usr/bin/env bash
# Write / refresh kubeconfig for the lab controller.
# Usage (from repo root on Mac or EC2):
#   ./deploy/eks/eks-kubeconfig.sh
#   EKS_KUBECONFIG_OUT=/opt/devlabs/kube/k8s-lab.kubeconfig ./deploy/eks/eks-kubeconfig.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$ROOT/../.." && pwd)"
# shellcheck source=env.sh
source "$ROOT/env.sh"
eks_need_aws

if ! eks_cluster_exists; then
  echo "cluster $EKS_CLUSTER_NAME not found" >&2
  exit 1
fi

OUT="$EKS_KUBECONFIG_OUT"
# Resolve relative paths from repo root
if [[ "$OUT" != /* ]]; then
  OUT="$REPO_ROOT/$OUT"
fi

mkdir -p "$(dirname "$OUT")"
echo "==> writing kubeconfig → $OUT"
aws eks update-kubeconfig \
  --name "$EKS_CLUSTER_NAME" \
  --region "$AWS_REGION" \
  --kubeconfig "$OUT"

chmod 600 "$OUT" 2>/dev/null || true
echo "==> test: kubectl --kubeconfig $OUT get ns"
kubectl --kubeconfig "$OUT" get ns >/dev/null
echo "==> ok"
