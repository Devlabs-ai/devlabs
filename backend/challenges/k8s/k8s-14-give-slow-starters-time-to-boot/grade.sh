#!/usr/bin/env bash
# Grade k8s-14-give-slow-starters-time-to-boot — Order Processor startup probe.
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
WANT_REPLICAS="2"

if ! kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" >/dev/null 2>&1; then
  fail "deployment/${DEPLOY} not found"
fi

DESIRED="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.spec.replicas}' 2>/dev/null || true)"
READY="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || true)"
[[ "$DESIRED" == "$WANT_REPLICAS" ]] || fail "replicas must be ${WANT_REPLICAS} (got '${DESIRED}')"
[[ "${READY:-0}" == "$WANT_REPLICAS" ]] || fail "readyReplicas must be ${WANT_REPLICAS} (got '${READY:-0}')"

IMAGE="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{range .spec.template.spec.containers[?(@.name=="order-processor")]}{.image}{end}' 2>/dev/null || true)"
[[ "$IMAGE" == *slow-order-processor:1.0* ]] \
  || fail "image must remain rithvikreddyalkanti/slow-order-processor:1.0 (got '${IMAGE}')"

SP_PATH="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{range .spec.template.spec.containers[?(@.name=="order-processor")]}{.startupProbe.httpGet.path}{end}' 2>/dev/null || true)"
SP_PORT="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{range .spec.template.spec.containers[?(@.name=="order-processor")]}{.startupProbe.httpGet.port}{end}' 2>/dev/null || true)"
SP_PERIOD="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{range .spec.template.spec.containers[?(@.name=="order-processor")]}{.startupProbe.periodSeconds}{end}' 2>/dev/null || true)"
SP_FAIL="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{range .spec.template.spec.containers[?(@.name=="order-processor")]}{.startupProbe.failureThreshold}{end}' 2>/dev/null || true)"
[[ "$SP_PATH" == "/health" ]] || fail "startupProbe httpGet.path must be /health (got '${SP_PATH}')"
[[ "$SP_PORT" == "8000" ]] || fail "startupProbe httpGet.port must be 8000 (got '${SP_PORT}')"
[[ "$SP_PERIOD" == "5" ]] || fail "startupProbe periodSeconds must be 5 (got '${SP_PERIOD}')"
[[ "$SP_FAIL" == "30" ]] || fail "startupProbe failureThreshold must be 30 (got '${SP_FAIL}')"

LP="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{range .spec.template.spec.containers[?(@.name=="order-processor")]}{.livenessProbe.httpGet.path}{end}' 2>/dev/null || true)"
RP="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{range .spec.template.spec.containers[?(@.name=="order-processor")]}{.readinessProbe.httpGet.path}{end}' 2>/dev/null || true)"
[[ -n "$LP" ]] || fail "livenessProbe must be preserved"
[[ -n "$RP" ]] || fail "readinessProbe must be preserved"

READY_PODS=0
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  name="$(echo "$line" | awk '{print $1}')"
  ready="$(echo "$line" | awk '{print $2}')"
  phase="$(echo "$line" | awk '{print $3}')"
  [[ "$phase" == "Running" ]] || fail "pod/${name} phase must be Running (got '${phase}')"
  [[ "$ready" == "1/1" ]] || fail "pod/${name} must be Ready 1/1 (got '${ready}')"
  READY_PODS=$((READY_PODS + 1))
done < <(kubectl -n "$LEARNER_NS" get pods -l app=order-processor --no-headers 2>/dev/null || true)
[[ "$READY_PODS" -ge "$WANT_REPLICAS" ]] || fail "need ${WANT_REPLICAS} Ready pods (got ${READY_PODS})"

pass "deployment/${DEPLOY} has startup+liveness+readiness; slow boot survived in ${LEARNER_NS}"
