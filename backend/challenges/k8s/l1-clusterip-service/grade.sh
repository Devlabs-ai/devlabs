#!/usr/bin/env bash
# Grade l1-clusterip-service — ClusterIP Service front-desk with endpoints.
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

SVC_NAME="front-desk"

if ! kubectl -n "$LEARNER_NS" get svc "$SVC_NAME" >/dev/null 2>&1; then
  fail "service/${SVC_NAME} not found in namespace ${LEARNER_NS}"
fi

TYPE="$(kubectl -n "$LEARNER_NS" get svc "$SVC_NAME" -o jsonpath='{.spec.type}' 2>/dev/null || true)"
SEL_APP="$(kubectl -n "$LEARNER_NS" get svc "$SVC_NAME" -o jsonpath='{.spec.selector.app}' 2>/dev/null || true)"
SEL_TIER="$(kubectl -n "$LEARNER_NS" get svc "$SVC_NAME" -o jsonpath='{.spec.selector.tier}' 2>/dev/null || true)"
PORT="$(kubectl -n "$LEARNER_NS" get svc "$SVC_NAME" -o jsonpath='{.spec.ports[0].port}' 2>/dev/null || true)"
TARGET="$(kubectl -n "$LEARNER_NS" get svc "$SVC_NAME" -o jsonpath='{.spec.ports[0].targetPort}' 2>/dev/null || true)"
# targetPort may be int or string name
ENDPOINTS="$(kubectl -n "$LEARNER_NS" get endpoints "$SVC_NAME" -o jsonpath='{.subsets[*].addresses[*].ip}' 2>/dev/null || true)"

[[ "$TYPE" == "ClusterIP" ]] || fail "service type must be ClusterIP (got '${TYPE}')"
[[ "$SEL_APP" == "guestbook" ]] || fail "selector.app must be guestbook (got '${SEL_APP}')"
[[ "$SEL_TIER" == "frontend" ]] || fail "selector.tier must be frontend (got '${SEL_TIER}')"
[[ "$PORT" == "80" ]] || fail "port must be 80 (got '${PORT}')"
[[ "$TARGET" == "80" ]] || fail "targetPort must be 80 (got '${TARGET}')"

if [[ -z "${ENDPOINTS// }" ]]; then
  fail "service/${SVC_NAME} has no Endpoints — selector may not match ready pods"
fi

pass "service/${SVC_NAME} is ClusterIP with endpoints in ${LEARNER_NS}"
