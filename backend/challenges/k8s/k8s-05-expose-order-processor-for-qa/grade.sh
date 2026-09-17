#!/usr/bin/env bash
# Grade k8s-05-expose-order-processor-for-qa — Order Processor NodePort Service.
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

SVC="order-processor-svc"
WANT_TYPE="NodePort"
WANT_APP="order-processor"
WANT_VERSION="v1.1"
WANT_PORT="8000"
WANT_NODE_PORT="30080"

if ! kubectl -n "$LEARNER_NS" get svc "$SVC" >/dev/null 2>&1; then
  fail "service/${SVC} not found in namespace ${LEARNER_NS}"
fi

TYPE="$(kubectl -n "$LEARNER_NS" get svc "$SVC" -o jsonpath='{.spec.type}' 2>/dev/null || true)"
[[ "$TYPE" == "$WANT_TYPE" ]] || fail "service type must be NodePort (got '${TYPE}')"

SEL_APP="$(kubectl -n "$LEARNER_NS" get svc "$SVC" -o jsonpath='{.spec.selector.app}' 2>/dev/null || true)"
SEL_VER="$(kubectl -n "$LEARNER_NS" get svc "$SVC" -o jsonpath='{.spec.selector.version}' 2>/dev/null || true)"
[[ "$SEL_APP" == "$WANT_APP" ]] || fail "selector app must be ${WANT_APP} (got '${SEL_APP}')"
[[ "$SEL_VER" == "$WANT_VERSION" ]] || fail "selector version must be ${WANT_VERSION} (got '${SEL_VER}')"

PORT="$(kubectl -n "$LEARNER_NS" get svc "$SVC" -o jsonpath='{.spec.ports[0].port}' 2>/dev/null || true)"
TARGET="$(kubectl -n "$LEARNER_NS" get svc "$SVC" -o jsonpath='{.spec.ports[0].targetPort}' 2>/dev/null || true)"
NODEPORT="$(kubectl -n "$LEARNER_NS" get svc "$SVC" -o jsonpath='{.spec.ports[0].nodePort}' 2>/dev/null || true)"
[[ "$PORT" == "$WANT_PORT" ]] || fail "port must be ${WANT_PORT} (got '${PORT}')"
[[ "$TARGET" == "$WANT_PORT" ]] || fail "targetPort must be ${WANT_PORT} (got '${TARGET}')"
[[ "$NODEPORT" == "$WANT_NODE_PORT" ]] || fail "nodePort must be ${WANT_NODE_PORT} (got '${NODEPORT}')"

READY_COUNT="$(kubectl -n "$LEARNER_NS" get endpoints "$SVC" -o jsonpath='{.subsets[*].addresses[*].ip}' 2>/dev/null | wc -w | tr -d ' ')"
[[ "${READY_COUNT:-0}" -ge 1 ]] || fail "service/${SVC} must have at least one ready Endpoint address (got ${READY_COUNT:-0})"

pass "service/${SVC} is NodePort ${WANT_NODE_PORT} selecting app=${WANT_APP},version=${WANT_VERSION} with ready Endpoints in ${LEARNER_NS}"
