#!/usr/bin/env bash
# Grade k8s-38-right-size-payment-handler-resources — VPA Off mode.
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

VPA="payment-handler-vpa"
DEPLOY="payment-handler"

if ! kubectl api-resources 2>/dev/null | grep -qi verticalpodautoscaler; then
  fail "VerticalPodAutoscaler CRD not available in this cluster — install VPA or apply when the platform provides it"
fi

if ! kubectl -n "$LEARNER_NS" get vpa "$VPA" >/dev/null 2>&1; then
  # try full resource name
  if ! kubectl -n "$LEARNER_NS" get verticalpodautoscaler "$VPA" >/dev/null 2>&1; then
    fail "verticalpodautoscaler/${VPA} not found"
  fi
fi

MODE="$(kubectl -n "$LEARNER_NS" get vpa "$VPA" -o jsonpath='{.spec.updatePolicy.updateMode}' 2>/dev/null || true)"
[[ "$MODE" == "Off" ]] || fail "updateMode must be Off (recommend only) (got '${MODE}')"

REF_KIND="$(kubectl -n "$LEARNER_NS" get vpa "$VPA" -o jsonpath='{.spec.targetRef.kind}' 2>/dev/null || true)"
REF_NAME="$(kubectl -n "$LEARNER_NS" get vpa "$VPA" -o jsonpath='{.spec.targetRef.name}' 2>/dev/null || true)"
[[ "$REF_KIND" == "Deployment" ]] || fail "targetRef.kind must be Deployment (got '${REF_KIND}')"
[[ "$REF_NAME" == "$DEPLOY" ]] || fail "targetRef.name must be ${DEPLOY} (got '${REF_NAME}')"

SOFT=""
REC="$(kubectl -n "$LEARNER_NS" get vpa "$VPA" -o jsonpath='{.status.recommendation.containerRecommendations[*].target.cpu}' 2>/dev/null || true)"
[[ -n "$REC" ]] || SOFT=" (soft: recommendations not populated yet — VPA object graded)"

pass "vpa/${VPA} targets deploy/${DEPLOY} with updateMode=Off${SOFT}"
