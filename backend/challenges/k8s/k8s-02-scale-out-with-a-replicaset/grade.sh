#!/usr/bin/env bash
# Grade k8s-02-scale-out-with-a-replicaset — Order Processor ReplicaSet.
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

RS_NAME="order-processor-rs"
WANT_REPLICAS="3"
WANT_IMAGE="rithvikreddyalkanti/order-processor:v1.0"
WANT_CONTAINER="order-processor"
WANT_PORT="8000"
WANT_APP="order-processor"
WANT_VERSION="v1.0"

# Must be a ReplicaSet — Deployments are the next lab.
if kubectl -n "$LEARNER_NS" get deploy "$RS_NAME" >/dev/null 2>&1; then
  fail "found Deployment/${RS_NAME} — this lab requires a ReplicaSet (not a Deployment)"
fi

if ! kubectl -n "$LEARNER_NS" get rs "$RS_NAME" >/dev/null 2>&1; then
  fail "replicaset/${RS_NAME} not found in namespace ${LEARNER_NS}"
fi

DESIRED="$(kubectl -n "$LEARNER_NS" get rs "$RS_NAME" -o jsonpath='{.spec.replicas}' 2>/dev/null || true)"
READY_RS="$(kubectl -n "$LEARNER_NS" get rs "$RS_NAME" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || true)"
[[ "$DESIRED" == "$WANT_REPLICAS" ]] || fail "replicas must be ${WANT_REPLICAS} (got '${DESIRED}')"
[[ "${READY_RS:-0}" == "$WANT_REPLICAS" ]] || fail "readyReplicas must be ${WANT_REPLICAS} (got '${READY_RS:-0}')"

SEL_APP="$(kubectl -n "$LEARNER_NS" get rs "$RS_NAME" -o jsonpath='{.spec.selector.matchLabels.app}' 2>/dev/null || true)"
SEL_VER="$(kubectl -n "$LEARNER_NS" get rs "$RS_NAME" -o jsonpath='{.spec.selector.matchLabels.version}' 2>/dev/null || true)"
TPL_APP="$(kubectl -n "$LEARNER_NS" get rs "$RS_NAME" -o jsonpath='{.spec.template.metadata.labels.app}' 2>/dev/null || true)"
TPL_VER="$(kubectl -n "$LEARNER_NS" get rs "$RS_NAME" -o jsonpath='{.spec.template.metadata.labels.version}' 2>/dev/null || true)"

[[ "$SEL_APP" == "$WANT_APP" ]] || fail "selector label app must be ${WANT_APP} (got '${SEL_APP}')"
[[ "$SEL_VER" == "$WANT_VERSION" ]] || fail "selector label version must be ${WANT_VERSION} (got '${SEL_VER}')"
[[ "$TPL_APP" == "$WANT_APP" ]] || fail "pod template label app must be ${WANT_APP} (got '${TPL_APP}')"
[[ "$TPL_VER" == "$WANT_VERSION" ]] || fail "pod template label version must be ${WANT_VERSION} (got '${TPL_VER}')"

CONTAINER_NAME="$(kubectl -n "$LEARNER_NS" get rs "$RS_NAME" -o jsonpath='{.spec.template.spec.containers[0].name}' 2>/dev/null || true)"
IMAGE="$(kubectl -n "$LEARNER_NS" get rs "$RS_NAME" -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || true)"
PORTS="$(kubectl -n "$LEARNER_NS" get rs "$RS_NAME" -o jsonpath='{.spec.template.spec.containers[0].ports[*].containerPort}' 2>/dev/null || true)"
CPU_REQ="$(kubectl -n "$LEARNER_NS" get rs "$RS_NAME" -o jsonpath='{.spec.template.spec.containers[0].resources.requests.cpu}' 2>/dev/null || true)"
MEM_REQ="$(kubectl -n "$LEARNER_NS" get rs "$RS_NAME" -o jsonpath='{.spec.template.spec.containers[0].resources.requests.memory}' 2>/dev/null || true)"

[[ "$CONTAINER_NAME" == "$WANT_CONTAINER" ]] || fail "container name must be ${WANT_CONTAINER} (got '${CONTAINER_NAME}')"
[[ "$IMAGE" == "$WANT_IMAGE" ]] || fail "image must be ${WANT_IMAGE} (got '${IMAGE}')"

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

case "$CPU_REQ" in
  100m|0.1) ;;
  *) fail "cpu request must be 100m (got '${CPU_REQ}')" ;;
esac
[[ "$MEM_REQ" == "128Mi" ]] || fail "memory request must be 128Mi (got '${MEM_REQ}')"

READY_PODS=0
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  name="$(echo "$line" | awk '{print $1}')"
  ready="$(echo "$line" | awk '{print $2}')"
  phase="$(echo "$line" | awk '{print $3}')"
  [[ "$phase" == "Running" ]] || fail "pod/${name} phase must be Running (got '${phase}')"
  [[ "$ready" == "1/1" ]] || fail "pod/${name} must be Ready 1/1 (got '${ready}')"
  READY_PODS=$((READY_PODS + 1))
done < <(kubectl -n "$LEARNER_NS" get pods -l "app=${WANT_APP},version=${WANT_VERSION}" --no-headers 2>/dev/null || true)

[[ "$READY_PODS" -ge "$WANT_REPLICAS" ]] || fail "need ${WANT_REPLICAS} Ready pods with app=${WANT_APP},version=${WANT_VERSION} (got ${READY_PODS})"

pass "replicaset/${RS_NAME} has ${WANT_REPLICAS} Ready pods in ${LEARNER_NS} with required image, labels, port, and resources"
