#!/usr/bin/env bash
# Grade k8s-27-colocate-notifications-near-orders — notification podAffinity.
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

DEP="notification-service"

kubectl -n "$LEARNER_NS" get deploy "$DEP" >/dev/null 2>&1 || fail "deployment/${DEP} not found"
REPLICAS="$(kubectl -n "$LEARNER_NS" get deploy "$DEP" -o jsonpath='{.spec.replicas}' 2>/dev/null || true)"
[[ "$REPLICAS" == "2" ]] || fail "replicas must be 2 (got '${REPLICAS}')"

WEIGHT="$(kubectl -n "$LEARNER_NS" get deploy "$DEP" -o jsonpath='{.spec.template.spec.affinity.podAffinity.preferredDuringSchedulingIgnoredDuringExecution[0].weight}' 2>/dev/null || true)"
TOPO="$(kubectl -n "$LEARNER_NS" get deploy "$DEP" -o jsonpath='{.spec.template.spec.affinity.podAffinity.preferredDuringSchedulingIgnoredDuringExecution[0].podAffinityTerm.topologyKey}' 2>/dev/null || true)"
APP="$(kubectl -n "$LEARNER_NS" get deploy "$DEP" -o jsonpath='{.spec.template.spec.affinity.podAffinity.preferredDuringSchedulingIgnoredDuringExecution[0].podAffinityTerm.labelSelector.matchLabels.app}' 2>/dev/null || true)"
[[ "$WEIGHT" == "100" ]] || fail "preferred weight must be 100 (got '${WEIGHT}')"
[[ "$TOPO" == "kubernetes.io/hostname" ]] || fail "topologyKey must be kubernetes.io/hostname (got '${TOPO}')"
[[ "$APP" == "order-processor" ]] || fail "podAffinity must target app=order-processor (got '${APP}')"

READY="$(kubectl -n "$LEARNER_NS" get deploy "$DEP" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || true)"
[[ "${READY:-0}" == "2" ]] || fail "readyReplicas must be 2 (got '${READY:-0}')"

pass "deployment/${DEP} prefers colocating with app=order-processor (2/2 Ready)"
