#!/usr/bin/env bash
# Park the Kubernetes-lab learner capacity while keeping system-k8s, Karpenter,
# Kyverno and the admission policies running (e.g. while only Linux labs are worked on).
#
#   1. warm + reserved balloons → 0   (otherwise Karpenter buys a labs node to hold them)
#   2. NodePool labs-elastic cpu limit → 0, and its existing nodes are removed
#   3. managed node group labs-k8s → 0
#
# Any learner pods still in ns-* go Pending. Bring the capacity back with:
#   ./deploy/eks/eks-wake.sh && ./deploy/eks/eks-karpenter.sh
# (re-applying karpenter/nodepool.yaml + balloons.yaml restores the limit and the 10 balloons)
#
# Usage (repo root, admin creds, kubeconfig from eks-kubeconfig.sh):
#   ./deploy/eks/eks-labs-sleep.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=env.sh
source "$ROOT/env.sh"
eks_need_aws

export KUBECONFIG="${KUBECONFIG:-$EKS_KUBECONFIG_OUT}"

if ! eks_cluster_exists; then
  echo "cluster $EKS_CLUSTER_NAME not found in $AWS_REGION" >&2
  exit 1
fi

echo "==> balloons → 0 (dl-system)"
kubectl -n dl-system scale deploy dl-balloon dl-balloon-reserved --replicas=0 2>/dev/null \
  || echo "    (balloons not installed)"

if kubectl get nodepool labs-elastic >/dev/null 2>&1; then
  echo "==> NodePool labs-elastic: cpu limit → 0, remove its nodes"
  kubectl patch nodepool labs-elastic --type merge -p '{"spec":{"limits":{"cpu":"0"}}}'
  kubectl delete nodeclaims -l karpenter.sh/nodepool=labs-elastic --wait=true --timeout=10m
fi

EKS_NODEGROUPS=labs-k8s "$ROOT/eks-sleep.sh"

echo "==> nodes"
kubectl get nodes -L devlabs.io/pool,karpenter.sh/nodepool
