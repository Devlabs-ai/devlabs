#!/usr/bin/env bash
# Grade k8s-12-restart-dead-order-processor-pods — Order Processor liveness probe.
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

PATH_P="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{range .spec.template.spec.containers[?(@.name=="order-processor")]}{.livenessProbe.httpGet.path}{end}' 2>/dev/null || true)"
PORT_P="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{range .spec.template.spec.containers[?(@.name=="order-processor")]}{.livenessProbe.httpGet.port}{end}' 2>/dev/null || true)"
INIT_D="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{range .spec.template.spec.containers[?(@.name=="order-processor")]}{.livenessProbe.initialDelaySeconds}{end}' 2>/dev/null || true)"
PERIOD="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{range .spec.template.spec.containers[?(@.name=="order-processor")]}{.livenessProbe.periodSeconds}{end}' 2>/dev/null || true)"
FAIL_T="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{range .spec.template.spec.containers[?(@.name=="order-processor")]}{.livenessProbe.failureThreshold}{end}' 2>/dev/null || true)"
IMAGE="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{range .spec.template.spec.containers[?(@.name=="order-processor")]}{.image}{end}' 2>/dev/null || true)"
MOUNT="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{range .spec.template.spec.containers[?(@.name=="order-processor")].volumeMounts[?(@.name=="zombie-mark")]}{.mountPath}{end}' 2>/dev/null || true)"

[[ "$PATH_P" == "/health" ]] || fail "livenessProbe httpGet.path must be /health (got '${PATH_P}')"
[[ "$PORT_P" == "8000" ]] || fail "livenessProbe httpGet.port must be 8000 (got '${PORT_P}')"
[[ "$INIT_D" == "10" ]] || fail "livenessProbe initialDelaySeconds must be 10 (got '${INIT_D}')"
[[ "$PERIOD" == "10" ]] || fail "livenessProbe periodSeconds must be 10 (got '${PERIOD}')"
[[ "$FAIL_T" == "3" ]] || fail "livenessProbe failureThreshold must be 3 (got '${FAIL_T}')"
[[ "$IMAGE" == *zombie-order-processor:1.0* ]] \
  || fail "image must remain rithvikreddyalkanti/zombie-order-processor:1.0 (got '${IMAGE}')"
# Mount is seeded lab plumbing (zombie marker); learners are not taught volumes yet.
[[ "$MOUNT" == "/var/run/zombie" ]] || fail "do not remove seeded pod template mounts (got '${MOUNT}')"

READY_PODS=0
RESTARTED=0
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  name="$(echo "$line" | awk '{print $1}')"
  ready="$(echo "$line" | awk '{print $2}')"
  status="$(echo "$line" | awk '{print $3}')"
  restarts="$(echo "$line" | awk '{print $4}')"
  # STATUS column may be Running; Restarts is column 4 in default get pods
  [[ "$status" == "Running" ]] || fail "pod/${name} phase must be Running (got '${status}')"
  [[ "$ready" == "1/1" ]] || fail "pod/${name} must be Ready 1/1 (got '${ready}')"
  if [[ "${restarts:-0}" =~ ^[0-9]+$ ]] && [[ "${restarts:-0}" -ge 1 ]]; then
    RESTARTED=$((RESTARTED + 1))
  fi
  READY_PODS=$((READY_PODS + 1))
done < <(kubectl -n "$LEARNER_NS" get pods -l app=order-processor --no-headers 2>/dev/null || true)
[[ "$READY_PODS" -ge "$WANT_REPLICAS" ]] || fail "need ${WANT_REPLICAS} Ready pods (got ${READY_PODS})"
[[ "$RESTARTED" -ge 1 ]] || fail "expected at least one Pod with RESTARTS>=1 (liveness should have killed the hung /health)"

pass "deployment/${DEPLOY} has HTTP livenessProbe; zombie /health revived after restart in ${LEARNER_NS}"

