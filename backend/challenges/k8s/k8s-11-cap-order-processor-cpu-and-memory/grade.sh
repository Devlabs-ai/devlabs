#!/usr/bin/env bash
# Grade k8s-11-cap-order-processor-cpu-and-memory — Order Processor resource limits.
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

# find order-processor container
CPU_REQ="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{range .spec.template.spec.containers[?(@.name=="order-processor")]}{.resources.requests.cpu}{end}' 2>/dev/null || true)"
MEM_REQ="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{range .spec.template.spec.containers[?(@.name=="order-processor")]}{.resources.requests.memory}{end}' 2>/dev/null || true)"
CPU_LIM="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{range .spec.template.spec.containers[?(@.name=="order-processor")]}{.resources.limits.cpu}{end}' 2>/dev/null || true)"
MEM_LIM="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{range .spec.template.spec.containers[?(@.name=="order-processor")]}{.resources.limits.memory}{end}' 2>/dev/null || true)"

case "$CPU_REQ" in 100m|0.1) ;; *) fail "cpu request must be 100m (got '${CPU_REQ}')" ;; esac
[[ "$MEM_REQ" == "128Mi" ]] || fail "memory request must be 128Mi (got '${MEM_REQ}')"
case "$CPU_LIM" in 250m|0.25) ;; *) fail "cpu limit must be 250m (got '${CPU_LIM}')" ;; esac
[[ "$MEM_LIM" == "256Mi" ]] || fail "memory limit must be 256Mi (got '${MEM_LIM}')"

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

pass "deployment/${DEPLOY} has requests+limits and ${WANT_REPLICAS} Ready pods in ${LEARNER_NS}"
