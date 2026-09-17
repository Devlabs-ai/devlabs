#!/usr/bin/env bash
# Grade k8s-41-rescue-crashlooping-notifications — healthy Notification Service.
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

DEPLOY="notification-service"
WANT_REPLICAS="2"
WANT_IMAGE="rithvikreddyalkanti/notification-service:v1.0"
WANT_PORT="8080"

if ! kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" >/dev/null 2>&1; then
  fail "deployment/${DEPLOY} not found — fix the existing Deployment in place"
fi

DESIRED="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.spec.replicas}' 2>/dev/null || true)"
READY="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || true)"
IMAGE="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || true)"
PORTS="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.spec.template.spec.containers[0].ports[*].containerPort}' 2>/dev/null || true)"

[[ "$DESIRED" == "$WANT_REPLICAS" ]] || fail "replicas must be ${WANT_REPLICAS} (got '${DESIRED}')"
[[ "${READY:-0}" == "$WANT_REPLICAS" ]] || fail "readyReplicas must be ${WANT_REPLICAS} (got '${READY:-0}')"
[[ "$IMAGE" == "$WANT_IMAGE" ]] || fail "image must be ${WANT_IMAGE} (got '${IMAGE}')"

if [[ -n "$PORTS" ]]; then
  FOUND=0
  for p in $PORTS; do [[ "$p" == "$WANT_PORT" ]] && FOUND=1 && break; done
  [[ "$FOUND" -eq 1 ]] || fail "containerPort must include ${WANT_PORT} when declared (got '${PORTS}')"
fi

# No CrashLoop / ImagePullBackOff on selected pods
BAD=0
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  name="$(echo "$line" | awk '{print $1}')"
  ready="$(echo "$line" | awk '{print $2}')"
  status="$(echo "$line" | awk '{print $3}')"
  case "$status" in
    CrashLoopBackOff|ImagePullBackOff|ErrImagePull|Error|CreateContainerConfigError)
      fail "pod/${name} still unhealthy (status=${status})"
      ;;
  esac
  [[ "$ready" == "1/1" || "$ready" == "2/2" ]] || true
done < <(kubectl -n "$LEARNER_NS" get pods -l app=notification-service --no-headers 2>/dev/null || true)

pass "deployment/${DEPLOY} rescued: ${WANT_REPLICAS}/${WANT_REPLICAS} Ready on ${WANT_IMAGE} in ${LEARNER_NS}"
