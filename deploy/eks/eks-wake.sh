#!/usr/bin/env bash
# Scale selected node groups back up for lab use.
# Usage:
#   ./deploy/eks/eks-wake.sh              # default: system-k8s=1, labs-k8s=1 (base)
#   EKS_WAKE_NODEGROUPS=labs-k8s ./deploy/eks/eks-wake.sh
#   EKS_WAKE_DESIRED=1 ./deploy/eks/eks-wake.sh   # force every group to 1
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=env.sh
source "$ROOT/env.sh"
eks_need_aws

if ! eks_cluster_exists; then
  echo "cluster $EKS_CLUSTER_NAME not found — run ./deploy/eks/eks-recreate.sh first" >&2
  exit 1
fi

echo "==> wake: scale node groups on $EKS_CLUSTER_NAME ($AWS_REGION)"
while IFS= read -r ng; do
  [[ -z "$ng" ]] && continue
  desired="$(eks_ng desired "$ng")"
  min="$(eks_ng min "$ng")"
  max="$(eks_ng max "$ng")"
  echo "--> $ng desired=$desired (min=$min max=$max)"
  aws eks update-nodegroup-config \
    --cluster-name "$EKS_CLUSTER_NAME" \
    --nodegroup-name "$ng" \
    --scaling-config "minSize=${min},maxSize=${max},desiredSize=${desired}" \
    --region "$AWS_REGION" >/dev/null
done < <(eks_csv_to_lines "$EKS_WAKE_NODEGROUPS")

echo "==> waiting for nodegroups ACTIVE (ASG can take a few minutes)"
while IFS= read -r ng; do
  [[ -z "$ng" ]] && continue
  eks_wait_nodegroup_active "$ng" || true
done < <(eks_csv_to_lines "$EKS_WAKE_NODEGROUPS")

if command -v kubectl >/dev/null 2>&1; then
  echo "==> kubectl get nodes"
  KUBECONFIG="${KUBECONFIG:-}" kubectl get nodes -o wide 2>/dev/null \
    || kubectl --kubeconfig "${EKS_KUBECONFIG_OUT}" get nodes -o wide 2>/dev/null \
    || echo "(no kubeconfig in env; nodes may still be joining — check Console)"
fi

echo "==> done"
