#!/usr/bin/env bash
# Grade l1-namespace-and-pod — QuickByte Order Processor Pod.
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

POD_NAME="order-processor-pod"
WANT_IMAGE="rithvikreddyalkanti/order-processor:v1.0"
WANT_CONTAINER="order-processor"
WANT_PORT="8000"

if ! kubectl -n "$LEARNER_NS" get pod "$POD_NAME" >/dev/null 2>&1; then
  fail "pod/${POD_NAME} not found in namespace ${LEARNER_NS}"
fi

CONTAINER_NAME="$(kubectl -n "$LEARNER_NS" get pod "$POD_NAME" -o jsonpath='{.spec.containers[0].name}' 2>/dev/null || true)"
IMAGE="$(kubectl -n "$LEARNER_NS" get pod "$POD_NAME" -o jsonpath='{.spec.containers[0].image}' 2>/dev/null || true)"
PHASE="$(kubectl -n "$LEARNER_NS" get pod "$POD_NAME" -o jsonpath='{.status.phase}' 2>/dev/null || true)"
READY="$(kubectl -n "$LEARNER_NS" get pod "$POD_NAME" -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || true)"
PORTS="$(kubectl -n "$LEARNER_NS" get pod "$POD_NAME" -o jsonpath='{.spec.containers[0].ports[*].containerPort}' 2>/dev/null || true)"
CPU_REQ="$(kubectl -n "$LEARNER_NS" get pod "$POD_NAME" -o jsonpath='{.spec.containers[0].resources.requests.cpu}' 2>/dev/null || true)"
MEM_REQ="$(kubectl -n "$LEARNER_NS" get pod "$POD_NAME" -o jsonpath='{.spec.containers[0].resources.requests.memory}' 2>/dev/null || true)"

[[ "$CONTAINER_NAME" == "$WANT_CONTAINER" ]] || fail "container name must be ${WANT_CONTAINER} (got '${CONTAINER_NAME}')"
[[ "$IMAGE" == "$WANT_IMAGE" ]] || fail "image must be ${WANT_IMAGE} (got '${IMAGE}')"
[[ "$PHASE" == "Running" ]] || fail "pod phase must be Running (got '${PHASE}')"
[[ "$READY" == "True" ]] || fail "pod must be Ready (got '${READY}')"

if [[ -z "$PORTS" ]]; then
  fail "containerPort ${WANT_PORT} must be declared on the container (got no ports)"
fi
FOUND_PORT=0
for p in $PORTS; do
  if [[ "$p" == "$WANT_PORT" ]]; then
    FOUND_PORT=1
    break
  fi
done
[[ "$FOUND_PORT" -eq 1 ]] || fail "containerPort must include ${WANT_PORT} (got '${PORTS}')"

# Accept 100m or 0.1
case "$CPU_REQ" in
  100m|0.1) ;;
  *) fail "cpu request must be 100m (got '${CPU_REQ}')" ;;
esac

[[ "$MEM_REQ" == "128Mi" ]] || fail "memory request must be 128Mi (got '${MEM_REQ}')"

pass "pod/${POD_NAME} is Running and Ready in ${LEARNER_NS} with required image, port, and resources"
