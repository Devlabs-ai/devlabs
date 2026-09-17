#!/usr/bin/env bash
# Grade k8s-04-stable-address-for-payment-handler — Payment Handler ClusterIP Service.
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

SVC="handler"
WANT_TYPE="ClusterIP"
WANT_APP="payment-handler"
WANT_PORT="8000"

if ! kubectl -n "$LEARNER_NS" get svc "$SVC" >/dev/null 2>&1; then
  fail "service/${SVC} not found in namespace ${LEARNER_NS}"
fi

TYPE="$(kubectl -n "$LEARNER_NS" get svc "$SVC" -o jsonpath='{.spec.type}' 2>/dev/null || true)"
# empty type means ClusterIP
[[ -z "$TYPE" || "$TYPE" == "$WANT_TYPE" ]] || fail "service type must be ClusterIP (got '${TYPE}')"

SEL="$(kubectl -n "$LEARNER_NS" get svc "$SVC" -o jsonpath='{.spec.selector.app}' 2>/dev/null || true)"
[[ "$SEL" == "$WANT_APP" ]] || fail "selector app must be ${WANT_APP} (got '${SEL}')"

PORT="$(kubectl -n "$LEARNER_NS" get svc "$SVC" -o jsonpath='{.spec.ports[0].port}' 2>/dev/null || true)"
TARGET="$(kubectl -n "$LEARNER_NS" get svc "$SVC" -o jsonpath='{.spec.ports[0].targetPort}' 2>/dev/null || true)"
[[ "$PORT" == "$WANT_PORT" ]] || fail "port must be ${WANT_PORT} (got '${PORT}')"
[[ "$TARGET" == "$WANT_PORT" ]] || fail "targetPort must be ${WANT_PORT} (got '${TARGET}')"

# ready endpoints via EndpointSlice or Endpoints
READY_COUNT="$(kubectl -n "$LEARNER_NS" get endpoints "$SVC" -o jsonpath='{.subsets[*].addresses[*].ip}' 2>/dev/null | wc -w | tr -d ' ')"
[[ "${READY_COUNT:-0}" -ge 1 ]] || fail "service/${SVC} must have at least one ready Endpoint address (got ${READY_COUNT:-0})"

pass "service/${SVC} is ClusterIP selecting app=${WANT_APP} on port ${WANT_PORT} with ready Endpoints in ${LEARNER_NS}"
