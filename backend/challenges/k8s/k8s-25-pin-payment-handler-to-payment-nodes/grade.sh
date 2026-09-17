#!/usr/bin/env bash
# Grade k8s-25-pin-payment-handler-to-payment-nodes — payment-handler nodeSelector.
set -euo pipefail

: "${LEARNER_NS:?LEARNER_NS required}"
: "${CHALLENGE_ID:?CHALLENGE_ID required}"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

pass() {
  echo "PASS: $*"
  exit 0
}

DEP="payment-handler"

kubectl -n "$LEARNER_NS" get deploy "$DEP" >/dev/null 2>&1 || fail "deployment/${DEP} not found"
REPLICAS="$(kubectl -n "$LEARNER_NS" get deploy "$DEP" -o jsonpath='{.spec.replicas}' 2>/dev/null || true)"
[[ "$REPLICAS" == "2" ]] || fail "replicas must be 2 (got '${REPLICAS}')"

NS_VAL="$(kubectl -n "$LEARNER_NS" get deploy "$DEP" -o jsonpath='{.spec.template.spec.nodeSelector.workload}' 2>/dev/null || true)"
[[ "$NS_VAL" == "payments" ]] || fail "nodeSelector.workload must be payments (got '${NS_VAL}')"

# Reject required nodeAffinity as substitute for this lab
REQ_AFF="$(kubectl -n "$LEARNER_NS" get deploy "$DEP" -o jsonpath='{.spec.template.spec.affinity.nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution}' 2>/dev/null || true)"
[[ -z "$REQ_AFF" ]] || fail "use nodeSelector only — do not use required nodeAffinity in this lab"

READY="$(kubectl -n "$LEARNER_NS" get deploy "$DEP" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || true)"
[[ "${READY:-0}" == "2" ]] || fail "readyReplicas must be 2 (got '${READY:-0}')"

# Verify scheduled nodes carry the label when possible
while IFS= read -r node; do
  [[ -z "$node" ]] && continue
  VAL="$(kubectl get node "$node" -o jsonpath='{.metadata.labels.workload}' 2>/dev/null || true)"
  [[ "$VAL" == "payments" ]] || fail "pod scheduled on ${node} without workload=payments"
done < <(kubectl -n "$LEARNER_NS" get pods -l app=payment-handler -o jsonpath='{range .items[*]}{.spec.nodeName}{"\n"}{end}' 2>/dev/null || true)

pass "deployment/${DEP} pinned with nodeSelector workload=payments (2/2 Ready)"
