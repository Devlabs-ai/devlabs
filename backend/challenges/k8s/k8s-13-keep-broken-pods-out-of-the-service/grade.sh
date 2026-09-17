#!/usr/bin/env bash
# Grade k8s-13-keep-broken-pods-out-of-the-service — Order Processor readiness probe.
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
SVC="order-processor-svc"
WANT_REPLICAS="2"

if ! kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" >/dev/null 2>&1; then
  fail "deployment/${DEPLOY} not found"
fi

DESIRED="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.spec.replicas}' 2>/dev/null || true)"
READY="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || true)"
[[ "$DESIRED" == "$WANT_REPLICAS" ]] || fail "replicas must be ${WANT_REPLICAS} (got '${DESIRED}')"
[[ "${READY:-0}" == "$WANT_REPLICAS" ]] || fail "readyReplicas must be ${WANT_REPLICAS} (got '${READY:-0}')"

PATH_P="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{range .spec.template.spec.containers[?(@.name=="order-processor")]}{.readinessProbe.httpGet.path}{end}' 2>/dev/null || true)"
PORT_P="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{range .spec.template.spec.containers[?(@.name=="order-processor")]}{.readinessProbe.httpGet.port}{end}' 2>/dev/null || true)"
INIT_D="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{range .spec.template.spec.containers[?(@.name=="order-processor")]}{.readinessProbe.initialDelaySeconds}{end}' 2>/dev/null || true)"
PERIOD="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{range .spec.template.spec.containers[?(@.name=="order-processor")]}{.readinessProbe.periodSeconds}{end}' 2>/dev/null || true)"
FAIL_T="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{range .spec.template.spec.containers[?(@.name=="order-processor")]}{.readinessProbe.failureThreshold}{end}' 2>/dev/null || true)"

[[ "$PATH_P" == "/health" ]] || fail "readinessProbe httpGet.path must be /health (got '${PATH_P}')"
[[ "$PORT_P" == "8000" ]] || fail "readinessProbe httpGet.port must be 8000 (got '${PORT_P}')"
[[ "$INIT_D" == "5" ]] || fail "readinessProbe initialDelaySeconds must be 5 (got '${INIT_D}')"
[[ "$PERIOD" == "5" ]] || fail "readinessProbe periodSeconds must be 5 (got '${PERIOD}')"
[[ "$FAIL_T" == "3" ]] || fail "readinessProbe failureThreshold must be 3 (got '${FAIL_T}')"

if ! kubectl -n "$LEARNER_NS" get svc "$SVC" >/dev/null 2>&1; then
  fail "service/${SVC} not found — do not remove the Service"
fi
READY_COUNT="$(kubectl -n "$LEARNER_NS" get endpoints "$SVC" -o jsonpath='{.subsets[*].addresses[*].ip}' 2>/dev/null | wc -w | tr -d ' ')"
[[ "${READY_COUNT:-0}" -ge 1 ]] || fail "service/${SVC} must have at least one ready Endpoint"

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

pass "deployment/${DEPLOY} has HTTP readinessProbe and ${SVC} has Endpoints in ${LEARNER_NS}"
