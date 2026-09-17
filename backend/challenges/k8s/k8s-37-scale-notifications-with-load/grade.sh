#!/usr/bin/env bash
# Grade k8s-37-scale-notifications-with-load — HPA CPU.
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

HPA="notification-service-hpa"
DEPLOY="notification-service"
WANT_MIN="1"
WANT_MAX="5"
WANT_CPU="50"

if ! kubectl -n "$LEARNER_NS" get hpa "$HPA" >/dev/null 2>&1; then
  fail "horizontalpodautoscaler/${HPA} not found"
fi

MIN="$(kubectl -n "$LEARNER_NS" get hpa "$HPA" -o jsonpath='{.spec.minReplicas}' 2>/dev/null || true)"
MAX="$(kubectl -n "$LEARNER_NS" get hpa "$HPA" -o jsonpath='{.spec.maxReplicas}' 2>/dev/null || true)"
REF_KIND="$(kubectl -n "$LEARNER_NS" get hpa "$HPA" -o jsonpath='{.spec.scaleTargetRef.kind}' 2>/dev/null || true)"
REF_NAME="$(kubectl -n "$LEARNER_NS" get hpa "$HPA" -o jsonpath='{.spec.scaleTargetRef.name}' 2>/dev/null || true)"

[[ "$MIN" == "$WANT_MIN" ]] || fail "minReplicas must be ${WANT_MIN} (got '${MIN}')"
[[ "$MAX" == "$WANT_MAX" ]] || fail "maxReplicas must be ${WANT_MAX} (got '${MAX}')"
[[ "$REF_KIND" == "Deployment" ]] || fail "scaleTargetRef.kind must be Deployment (got '${REF_KIND}')"
[[ "$REF_NAME" == "$DEPLOY" ]] || fail "scaleTargetRef.name must be ${DEPLOY} (got '${REF_NAME}')"

# CPU target — metrics API v2
CPU="$(kubectl -n "$LEARNER_NS" get hpa "$HPA" -o jsonpath='{.spec.metrics[?(@.type=="Resource")].resource.target.averageUtilization}' 2>/dev/null || true)"
if [[ -z "$CPU" ]]; then
  CPU="$(kubectl -n "$LEARNER_NS" get hpa "$HPA" -o jsonpath='{.spec.targetCPUUtilizationPercentage}' 2>/dev/null || true)"
fi
[[ "$CPU" == "$WANT_CPU" ]] || fail "CPU averageUtilization must be ${WANT_CPU} (got '${CPU}')"

if ! kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" >/dev/null 2>&1; then
  fail "deployment/${DEPLOY} not found (HPA target)"
fi

# Deployment should have CPU requests for HPA
CPU_REQ="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.spec.template.spec.containers[0].resources.requests.cpu}' 2>/dev/null || true)"
[[ -n "$CPU_REQ" ]] || fail "deployment/${DEPLOY} must set CPU requests for HPA metrics"

CURRENT="$(kubectl -n "$LEARNER_NS" get hpa "$HPA" -o jsonpath='{.status.currentReplicas}' 2>/dev/null || true)"
DESIRED_HPA="$(kubectl -n "$LEARNER_NS" get hpa "$HPA" -o jsonpath='{.status.desiredReplicas}' 2>/dev/null || true)"
SOFT=""
if [[ -z "$CURRENT" && -z "$DESIRED_HPA" ]]; then
  SOFT=" (soft: HPA status not populated yet — SPEC object graded)"
fi

pass "hpa/${HPA} targets deploy/${DEPLOY} min=${WANT_MIN} max=${WANT_MAX} cpu=${WANT_CPU}%${SOFT}"
