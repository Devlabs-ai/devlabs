#!/usr/bin/env bash
# Grade k8s-30-canary-the-notification-service — notification canary.
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

STABLE="notification-service"
CANARY="notification-service-canary"
SVC="notification-service"

kubectl -n "$LEARNER_NS" get deploy "$STABLE" >/dev/null 2>&1 || fail "deployment/${STABLE} not found"
kubectl -n "$LEARNER_NS" get deploy "$CANARY" >/dev/null 2>&1 || fail "deployment/${CANARY} not found"

S_REP="$(kubectl -n "$LEARNER_NS" get deploy "$STABLE" -o jsonpath='{.spec.replicas}' 2>/dev/null || true)"
C_REP="$(kubectl -n "$LEARNER_NS" get deploy "$CANARY" -o jsonpath='{.spec.replicas}' 2>/dev/null || true)"
[[ "$S_REP" == "4" ]] || fail "stable replicas must be 4 (got '${S_REP}')"
[[ "$C_REP" == "1" ]] || fail "canary replicas must be 1 (got '${C_REP}')"

S_IMG="$(kubectl -n "$LEARNER_NS" get deploy "$STABLE" -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || true)"
C_IMG="$(kubectl -n "$LEARNER_NS" get deploy "$CANARY" -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || true)"
[[ "$S_IMG" == "rithvikreddyalkanti/notification-service:v1.0" ]] || fail "stable image must be …:v1.0 (got '${S_IMG}')"
[[ "$C_IMG" == "rithvikreddyalkanti/notification-service:v1.1" ]] || fail "canary image must be …:v1.1 (got '${C_IMG}')"

S_TRACK="$(kubectl -n "$LEARNER_NS" get deploy "$STABLE" -o jsonpath='{.spec.template.metadata.labels.track}' 2>/dev/null || true)"
C_TRACK="$(kubectl -n "$LEARNER_NS" get deploy "$CANARY" -o jsonpath='{.spec.template.metadata.labels.track}' 2>/dev/null || true)"
[[ "$S_TRACK" == "stable" ]] || fail "stable track label must be stable (got '${S_TRACK}')"
[[ "$C_TRACK" == "canary" ]] || fail "canary track label must be canary (got '${C_TRACK}')"

S_SEL_TRACK="$(kubectl -n "$LEARNER_NS" get deploy "$STABLE" -o jsonpath='{.spec.selector.matchLabels.track}' 2>/dev/null || true)"
C_SEL_TRACK="$(kubectl -n "$LEARNER_NS" get deploy "$CANARY" -o jsonpath='{.spec.selector.matchLabels.track}' 2>/dev/null || true)"
[[ "$S_SEL_TRACK" == "stable" ]] || fail "stable selector.track must be stable so it does not adopt canary pods (got '${S_SEL_TRACK}')"
[[ "$C_SEL_TRACK" == "canary" ]] || fail "canary selector.track must be canary (got '${C_SEL_TRACK}')"

C_PORT="$(kubectl -n "$LEARNER_NS" get deploy "$CANARY" -o jsonpath='{.spec.template.spec.containers[0].ports[0].containerPort}' 2>/dev/null || true)"
[[ "$C_PORT" == "8080" ]] || fail "canary containerPort must be 8080 (got '${C_PORT}')"

S_READY="$(kubectl -n "$LEARNER_NS" get deploy "$STABLE" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || true)"
C_READY="$(kubectl -n "$LEARNER_NS" get deploy "$CANARY" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || true)"
[[ "${S_READY:-0}" == "4" ]] || fail "stable readyReplicas must be 4 (got '${S_READY:-0}')"
[[ "${C_READY:-0}" == "1" ]] || fail "canary readyReplicas must be 1 (got '${C_READY:-0}')"

kubectl -n "$LEARNER_NS" get svc "$SVC" >/dev/null 2>&1 || fail "service/${SVC} not found"
SEL="$(kubectl -n "$LEARNER_NS" get svc "$SVC" -o jsonpath='{.spec.selector.app}' 2>/dev/null || true)"
[[ "$SEL" == "notification-service" ]] || fail "Service selector.app must remain notification-service (got '${SEL}')"

EPS="$(kubectl -n "$LEARNER_NS" get endpoints "$SVC" -o jsonpath='{.subsets[*].addresses[*].ip}' 2>/dev/null || true)"
COUNT=0
for ip in $EPS; do COUNT=$((COUNT+1)); done
[[ "$COUNT" -ge 5 ]] || fail "Service endpoints must include >=5 addresses (got ${COUNT})"

pass "canary + stable ready; service/${SVC} has ${COUNT} endpoints"
