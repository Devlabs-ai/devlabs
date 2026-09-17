#!/usr/bin/env bash
# Grade k8s-06-config-without-rebuilding-images — ConfigMap + Order Processor Deployment.
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

CM="order-processor-config"
DEPLOY="order-processor-deploy"
WANT_REPLICAS="3"
WANT_IMAGE="rithvikreddyalkanti/order-processor:v1.2"
WANT_CONTAINER="order-processor"
WANT_PORT="8000"
WANT_APP="order-processor"
WANT_VERSION="v1.2"

if ! kubectl -n "$LEARNER_NS" get cm "$CM" >/dev/null 2>&1; then
  fail "configmap/${CM} not found in namespace ${LEARNER_NS}"
fi

for KEY in MIN_ORDER_VALUE MAX_ITEMS_PER_ORDER LOG_LEVEL; do
  VAL="$(kubectl -n "$LEARNER_NS" get cm "$CM" -o jsonpath="{.data.$KEY}" 2>/dev/null || true)"
  case "$KEY" in
    MIN_ORDER_VALUE) WANT="50" ;;
    MAX_ITEMS_PER_ORDER) WANT="20" ;;
    LOG_LEVEL) WANT="INFO" ;;
  esac
  [[ "$VAL" == "$WANT" ]] || fail "configmap ${CM} key ${KEY} must be ${WANT} (got '${VAL}')"
done

if ! kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" >/dev/null 2>&1; then
  fail "deployment/${DEPLOY} not found in namespace ${LEARNER_NS}"
fi

DESIRED="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.spec.replicas}' 2>/dev/null || true)"
READY="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || true)"
[[ "$DESIRED" == "$WANT_REPLICAS" ]] || fail "replicas must be ${WANT_REPLICAS} (got '${DESIRED}')"
[[ "${READY:-0}" == "$WANT_REPLICAS" ]] || fail "readyReplicas must be ${WANT_REPLICAS} (got '${READY:-0}')"

TPL_APP="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.spec.template.metadata.labels.app}' 2>/dev/null || true)"
TPL_VER="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.spec.template.metadata.labels.version}' 2>/dev/null || true)"
[[ "$TPL_APP" == "$WANT_APP" ]] || fail "pod template label app must be ${WANT_APP} (got '${TPL_APP}')"
[[ "$TPL_VER" == "$WANT_VERSION" ]] || fail "pod template label version must be ${WANT_VERSION} (got '${TPL_VER}')"

CONTAINER_NAME="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.spec.template.spec.containers[0].name}' 2>/dev/null || true)"
IMAGE="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || true)"
PORTS="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.spec.template.spec.containers[0].ports[*].containerPort}' 2>/dev/null || true)"
CPU_REQ="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.spec.template.spec.containers[0].resources.requests.cpu}' 2>/dev/null || true)"
MEM_REQ="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.spec.template.spec.containers[0].resources.requests.memory}' 2>/dev/null || true)"
[[ "$CONTAINER_NAME" == "$WANT_CONTAINER" ]] || fail "container name must be ${WANT_CONTAINER} (got '${CONTAINER_NAME}')"
[[ "$IMAGE" == "$WANT_IMAGE" ]] || fail "image must be ${WANT_IMAGE} (got '${IMAGE}')"
if [[ -z "$PORTS" ]]; then fail "containerPort ${WANT_PORT} must be declared"; fi
FOUND_PORT=0
for p in $PORTS; do [[ "$p" == "$WANT_PORT" ]] && FOUND_PORT=1; done
[[ "$FOUND_PORT" -eq 1 ]] || fail "containerPort must include ${WANT_PORT} (got '${PORTS}')"
case "$CPU_REQ" in 100m|0.1) ;; *) fail "cpu request must be 100m (got '${CPU_REQ}')" ;; esac
[[ "$MEM_REQ" == "128Mi" ]] || fail "memory request must be 128Mi (got '${MEM_REQ}')"

# ConfigMap must be referenced as env (envFrom or valueFrom)
SPEC_JSON="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o json 2>/dev/null || true)"
echo "$SPEC_JSON" | grep -q "order-processor-config" || fail "deployment must reference ConfigMap ${CM} for environment injection"
# Ensure each key appears somehow in env wiring OR envFrom covers all
ENVFROM="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.spec.template.spec.containers[0].envFrom[*].configMapRef.name}' 2>/dev/null || true)"
if [[ "$ENVFROM" != *"$CM"* ]]; then
  for KEY in MIN_ORDER_VALUE MAX_ITEMS_PER_ORDER LOG_LEVEL; do
    FOUND=0
    while IFS= read -r ename; do
      [[ "$ename" == "$KEY" ]] && FOUND=1
    done < <(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{range .spec.template.spec.containers[0].env[*]}{.name}{"\n"}{end}' 2>/dev/null || true)
    [[ "$FOUND" -eq 1 ]] || fail "env var ${KEY} must be injected from ConfigMap (or use envFrom)"
  done
fi

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
[[ "$READY_PODS" -ge "$WANT_REPLICAS" ]] || fail "need ${WANT_REPLICAS} Ready pods (got ${READY_PODS})"

pass "configmap/${CM} and deployment/${DEPLOY} ready in ${LEARNER_NS} with ConfigMap env injection"
