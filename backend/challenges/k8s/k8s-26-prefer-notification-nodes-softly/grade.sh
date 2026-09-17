#!/usr/bin/env bash
# Grade k8s-26-prefer-notification-nodes-softly — notification soft nodeAffinity.
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

# Must not use nodeSelector for this lab
NS="$(kubectl -n "$LEARNER_NS" get deploy "$DEP" -o jsonpath='{.spec.template.spec.nodeSelector}' 2>/dev/null || true)"
[[ -z "$NS" ]] || fail "use nodeAffinity, not nodeSelector"

REQ="$(kubectl -n "$LEARNER_NS" get deploy "$DEP" -o jsonpath='{.spec.template.spec.affinity.nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution}' 2>/dev/null || true)"
[[ -z "$REQ" ]] || fail "do not add required node affinity"

WEIGHT="$(kubectl -n "$LEARNER_NS" get deploy "$DEP" -o jsonpath='{.spec.template.spec.affinity.nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution[0].weight}' 2>/dev/null || true)"
KEY="$(kubectl -n "$LEARNER_NS" get deploy "$DEP" -o jsonpath='{.spec.template.spec.affinity.nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution[0].preference.matchExpressions[0].key}' 2>/dev/null || true)"
VAL="$(kubectl -n "$LEARNER_NS" get deploy "$DEP" -o jsonpath='{.spec.template.spec.affinity.nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution[0].preference.matchExpressions[0].values[0]}' 2>/dev/null || true)"
[[ "$WEIGHT" == "100" ]] || fail "preferred weight must be 100 (got '${WEIGHT}')"
[[ "$KEY" == "workload" ]] || fail "affinity key must be workload (got '${KEY}')"
[[ "$VAL" == "notifications" ]] || fail "affinity value must be notifications (got '${VAL}')"

READY="$(kubectl -n "$LEARNER_NS" get deploy "$DEP" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || true)"
[[ "${READY:-0}" == "2" ]] || fail "readyReplicas must be 2 (got '${READY:-0}')"

pass "deployment/${DEP} has preferred nodeAffinity for workload=notifications (2/2 Ready)"
