#!/usr/bin/env bash
# Apply native ValidatingAdmissionPolicies that keep learner workloads (ns-*)
# inside their lab ResourceQuota / LimitRange. No webhook service; runs in the
# API server. Idempotent.
#
# Usage (repo root, kubeconfig from eks-kubeconfig.sh):
#   ./deploy/eks/eks-admission.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=env.sh
source "$ROOT/env.sh"

export KUBECONFIG="${KUBECONFIG:-$EKS_KUBECONFIG_OUT}"

echo "==> learner resource policies (dl-learner-*)"
kubectl apply -f "$ROOT/admission/learner-resource-policies.yaml"

echo "==> type-check warnings (empty = clean)"
kubectl get validatingadmissionpolicies -o json \
  | jq -r '.items[] | select(.metadata.name | startswith("dl-learner-"))
      | select((.status.typeChecking.expressionWarnings // []) | length > 0)
      | "\(.metadata.name): \(.status.typeChecking.expressionWarnings)"'

echo "==> done"
