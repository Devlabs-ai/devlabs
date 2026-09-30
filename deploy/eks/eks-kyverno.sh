#!/usr/bin/env bash
# Install / upgrade Kyverno (admission controller only) and the policy that marks
# learner pods (ns-*) as karpenter.sh/do-not-disrupt. Idempotent.
#
# Usage (repo root, kubeconfig from eks-kubeconfig.sh):
#   ./deploy/eks/eks-kyverno.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=env.sh
source "$ROOT/env.sh"

export KUBECONFIG="${KUBECONFIG:-$EKS_KUBECONFIG_OUT}"

echo "==> helm kyverno chart $KYVERNO_CHART_VERSION → namespace kyverno (system-k8s)"
helm repo add kyverno https://kyverno.github.io/kyverno/ >/dev/null 2>&1 || true
helm repo update kyverno >/dev/null
helm upgrade --install kyverno kyverno/kyverno \
  --version "$KYVERNO_CHART_VERSION" \
  --namespace kyverno --create-namespace \
  -f "$ROOT/kyverno/values.yaml" \
  --wait

echo "==> policy learner-pods-do-not-disrupt"
kubectl apply -f "$ROOT/kyverno/learner-do-not-disrupt.yaml"
kubectl wait --for=jsonpath='{.status.conditionStatus.ready}'=true \
  mutatingpolicy/learner-pods-do-not-disrupt --timeout=120s
kubectl get mutatingadmissionpolicies,mutatingadmissionpolicybindings 2>/dev/null | rg -i learner \
  || echo "    (no native MutatingAdmissionPolicy generated; enforced via Kyverno webhook)"

echo "==> done"
