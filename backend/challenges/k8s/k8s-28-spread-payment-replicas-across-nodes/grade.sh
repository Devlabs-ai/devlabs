#!/usr/bin/env bash
# Grade k8s-28-spread-payment-replicas-across-nodes — payment podAntiAffinity.
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
[[ "$REPLICAS" == "3" ]] || fail "replicas must be 3 (got '${REPLICAS}')"

WEIGHT="$(kubectl -n "$LEARNER_NS" get deploy "$DEP" -o jsonpath='{.spec.template.spec.affinity.podAntiAffinity.preferredDuringSchedulingIgnoredDuringExecution[0].weight}' 2>/dev/null || true)"
TOPO="$(kubectl -n "$LEARNER_NS" get deploy "$DEP" -o jsonpath='{.spec.template.spec.affinity.podAntiAffinity.preferredDuringSchedulingIgnoredDuringExecution[0].podAffinityTerm.topologyKey}' 2>/dev/null || true)"
APP="$(kubectl -n "$LEARNER_NS" get deploy "$DEP" -o jsonpath='{.spec.template.spec.affinity.podAntiAffinity.preferredDuringSchedulingIgnoredDuringExecution[0].podAffinityTerm.labelSelector.matchLabels.app}' 2>/dev/null || true)"
[[ "$WEIGHT" == "100" ]] || fail "preferred weight must be 100 (got '${WEIGHT}')"
[[ "$TOPO" == "kubernetes.io/hostname" ]] || fail "topologyKey must be kubernetes.io/hostname (got '${TOPO}')"
[[ "$APP" == "payment-handler" ]] || fail "anti-affinity must target app=payment-handler (got '${APP}')"

READY="$(kubectl -n "$LEARNER_NS" get deploy "$DEP" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || true)"
[[ "${READY:-0}" == "3" ]] || fail "readyReplicas must be 3 (got '${READY:-0}')"

pass "deployment/${DEP} has preferred podAntiAffinity and 3/3 Ready"
