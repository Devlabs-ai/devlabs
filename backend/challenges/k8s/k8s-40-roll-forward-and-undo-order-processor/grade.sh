#!/usr/bin/env bash
# Grade k8s-40-roll-forward-and-undo-order-processor — rolling update + undo end state.
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

DEPLOY="order-processor-deploy"
WANT_REPLICAS="3"
WANT_IMAGE="rithvikreddyalkanti/order-processor:v1.1"
WANT_SURGE="1"
WANT_UNAVAIL="0"

if ! kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" >/dev/null 2>&1; then
  fail "deployment/${DEPLOY} not found"
fi

STRAT="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.spec.strategy.type}' 2>/dev/null || true)"
SURGE="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.spec.strategy.rollingUpdate.maxSurge}' 2>/dev/null || true)"
UNAVAIL="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.spec.strategy.rollingUpdate.maxUnavailable}' 2>/dev/null || true)"
IMAGE="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || true)"
DESIRED="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.spec.replicas}' 2>/dev/null || true)"
READY="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || true)"

[[ "$STRAT" == "RollingUpdate" ]] || fail "strategy.type must be RollingUpdate (got '${STRAT}')"
# maxSurge/maxUnavailable may be int or string
[[ "$SURGE" == "$WANT_SURGE" || "$SURGE" == "1" ]] || fail "maxSurge must be ${WANT_SURGE} (got '${SURGE}')"
[[ "$UNAVAIL" == "$WANT_UNAVAIL" || "$UNAVAIL" == "0" ]] || fail "maxUnavailable must be ${WANT_UNAVAIL} (got '${UNAVAIL}')"
[[ "$IMAGE" == "$WANT_IMAGE" ]] || fail "after rollback, image must be ${WANT_IMAGE} (got '${IMAGE}') — undo after rolling to v1.2"
[[ "$DESIRED" == "$WANT_REPLICAS" ]] || fail "replicas must be ${WANT_REPLICAS} (got '${DESIRED}')"
[[ "${READY:-0}" == "$WANT_REPLICAS" ]] || fail "readyReplicas must be ${WANT_REPLICAS} (got '${READY:-0}')"

# Soft: revision history should show more than one revision if undo happened
REVS="$(kubectl -n "$LEARNER_NS" rollout history deploy/"$DEPLOY" 2>/dev/null | grep -c '^[0-9]' || true)"
SOFT=""
[[ "${REVS:-0}" -ge 2 ]] || SOFT=" (soft: rollout history <2 revisions — end-state image/strategy graded)"

pass "deploy/${DEPLOY} RollingUpdate maxSurge=${WANT_SURGE} maxUnavailable=${WANT_UNAVAIL}; rolled back to ${WANT_IMAGE}; 3/3 Ready${SOFT}"
