#!/usr/bin/env bash
# Grade l1-imperative-kubectl — Deployment + ClusterIP Service pop-up.
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

NAME="pop-up"
WANT_REPLICAS=2

if ! kubectl -n "$LEARNER_NS" get deploy "$NAME" >/dev/null 2>&1; then
  fail "deployment/${NAME} not found in namespace ${LEARNER_NS}"
fi

REPLICAS="$(kubectl -n "$LEARNER_NS" get deploy "$NAME" -o jsonpath='{.spec.replicas}' 2>/dev/null || true)"
READY="$(kubectl -n "$LEARNER_NS" get deploy "$NAME" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || true)"
IMAGE="$(kubectl -n "$LEARNER_NS" get deploy "$NAME" -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || true)"
APP_LABEL="$(kubectl -n "$LEARNER_NS" get deploy "$NAME" -o jsonpath='{.metadata.labels.app}' 2>/dev/null || true)"
TIER_LABEL="$(kubectl -n "$LEARNER_NS" get deploy "$NAME" -o jsonpath='{.metadata.labels.tier}' 2>/dev/null || true)"

[[ "$REPLICAS" == "$WANT_REPLICAS" ]] || fail "spec.replicas must be ${WANT_REPLICAS} (got '${REPLICAS}')"
[[ "$IMAGE" == *nginx* ]] || fail "container image must be nginx (got '${IMAGE}')"
[[ "${READY:-0}" == "$WANT_REPLICAS" ]] || fail "readyReplicas must be ${WANT_REPLICAS} (got '${READY:-0}')"
[[ "$APP_LABEL" == "guestbook" ]] || fail "deployment label app must be guestbook (got '${APP_LABEL}')"
[[ "$TIER_LABEL" == "popup" ]] || fail "deployment label tier must be popup (got '${TIER_LABEL}')"

if ! kubectl -n "$LEARNER_NS" get svc "$NAME" >/dev/null 2>&1; then
  fail "service/${NAME} not found in namespace ${LEARNER_NS}"
fi

TYPE="$(kubectl -n "$LEARNER_NS" get svc "$NAME" -o jsonpath='{.spec.type}' 2>/dev/null || true)"
PORT="$(kubectl -n "$LEARNER_NS" get svc "$NAME" -o jsonpath='{.spec.ports[0].port}' 2>/dev/null || true)"
TARGET="$(kubectl -n "$LEARNER_NS" get svc "$NAME" -o jsonpath='{.spec.ports[0].targetPort}' 2>/dev/null || true)"
ENDPOINTS="$(kubectl -n "$LEARNER_NS" get endpoints "$NAME" -o jsonpath='{.subsets[*].addresses[*].ip}' 2>/dev/null || true)"

[[ "$TYPE" == "ClusterIP" ]] || fail "service type must be ClusterIP (got '${TYPE}')"
[[ "$PORT" == "80" ]] || fail "port must be 80 (got '${PORT}')"
[[ "$TARGET" == "80" ]] || fail "targetPort must be 80 (got '${TARGET}')"

if [[ -z "${ENDPOINTS// }" ]]; then
  fail "service/${NAME} has no Endpoints — expose may not match ready pods"
fi

pass "deployment+service/${NAME} ready in ${LEARNER_NS}"
