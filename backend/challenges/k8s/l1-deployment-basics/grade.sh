#!/usr/bin/env bash
# Grade l1-deployment-basics — Deployment front-desk with 3 Available replicas.
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

DEP_NAME="front-desk"
WANT_REPLICAS=3

if ! kubectl -n "$LEARNER_NS" get deploy "$DEP_NAME" >/dev/null 2>&1; then
  fail "deployment/${DEP_NAME} not found in namespace ${LEARNER_NS}"
fi

REPLICAS="$(kubectl -n "$LEARNER_NS" get deploy "$DEP_NAME" -o jsonpath='{.spec.replicas}' 2>/dev/null || true)"
READY="$(kubectl -n "$LEARNER_NS" get deploy "$DEP_NAME" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || true)"
AVAILABLE="$(kubectl -n "$LEARNER_NS" get deploy "$DEP_NAME" -o jsonpath='{.status.availableReplicas}' 2>/dev/null || true)"
IMAGE="$(kubectl -n "$LEARNER_NS" get deploy "$DEP_NAME" -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || true)"
PORTS="$(kubectl -n "$LEARNER_NS" get deploy "$DEP_NAME" -o jsonpath='{.spec.template.spec.containers[0].ports[*].containerPort}' 2>/dev/null || true)"

SEL_APP="$(kubectl -n "$LEARNER_NS" get deploy "$DEP_NAME" -o jsonpath='{.spec.selector.matchLabels.app}' 2>/dev/null || true)"
SEL_TIER="$(kubectl -n "$LEARNER_NS" get deploy "$DEP_NAME" -o jsonpath='{.spec.selector.matchLabels.tier}' 2>/dev/null || true)"
TPL_APP="$(kubectl -n "$LEARNER_NS" get deploy "$DEP_NAME" -o jsonpath='{.spec.template.metadata.labels.app}' 2>/dev/null || true)"
TPL_TIER="$(kubectl -n "$LEARNER_NS" get deploy "$DEP_NAME" -o jsonpath='{.spec.template.metadata.labels.tier}' 2>/dev/null || true)"

[[ "$REPLICAS" == "$WANT_REPLICAS" ]] || fail "spec.replicas must be ${WANT_REPLICAS} (got '${REPLICAS}')"
[[ "$SEL_APP" == "guestbook" ]] || fail "selector matchLabels.app must be guestbook (got '${SEL_APP}')"
[[ "$SEL_TIER" == "frontend" ]] || fail "selector matchLabels.tier must be frontend (got '${SEL_TIER}')"
[[ "$TPL_APP" == "guestbook" ]] || fail "template labels.app must be guestbook (got '${TPL_APP}')"
[[ "$TPL_TIER" == "frontend" ]] || fail "template labels.tier must be frontend (got '${TPL_TIER}')"
[[ "$IMAGE" == *nginx* ]] || fail "container image must be nginx (got '${IMAGE}')"

if [[ -z "$PORTS" ]]; then
  fail "containerPort 80 must be declared on the pod template (got no ports)"
fi
FOUND_80=0
for p in $PORTS; do
  if [[ "$p" == "80" ]]; then
    FOUND_80=1
    break
  fi
done
[[ "$FOUND_80" -eq 1 ]] || fail "containerPort must include 80 (got '${PORTS}')"

READY_N="${READY:-0}"
AVAILABLE_N="${AVAILABLE:-0}"
[[ "$READY_N" == "$WANT_REPLICAS" ]] || fail "readyReplicas must be ${WANT_REPLICAS} (got '${READY_N}')"
[[ "$AVAILABLE_N" == "$WANT_REPLICAS" ]] || fail "availableReplicas must be ${WANT_REPLICAS} (got '${AVAILABLE_N}')"

pass "deployment/${DEP_NAME} has ${WANT_REPLICAS} Available replicas in ${LEARNER_NS}"
