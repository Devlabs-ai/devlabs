#!/usr/bin/env bash
# Grade k8s-31-blue-green-cutover-for-payment-handler — Blue-Green cutover.
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

GREEN="payment-handler-green"
BLUE="payment-handler-blue"
SVC="payment-handler"
WANT_REPLICAS="3"
WANT_IMAGE="rithvikreddyalkanti/payment-handler:v1.1"
WANT_APP="payment-handler"
WANT_COLOR="green"
WANT_PORT="8000"

if ! kubectl -n "$LEARNER_NS" get deploy "$GREEN" >/dev/null 2>&1; then
  fail "deployment/${GREEN} not found in namespace ${LEARNER_NS}"
fi

DESIRED="$(kubectl -n "$LEARNER_NS" get deploy "$GREEN" -o jsonpath='{.spec.replicas}' 2>/dev/null || true)"
READY="$(kubectl -n "$LEARNER_NS" get deploy "$GREEN" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || true)"
[[ "$DESIRED" == "$WANT_REPLICAS" ]] || fail "green replicas must be ${WANT_REPLICAS} (got '${DESIRED}')"
[[ "${READY:-0}" == "$WANT_REPLICAS" ]] || fail "green readyReplicas must be ${WANT_REPLICAS} (got '${READY:-0}')"

TPL_APP="$(kubectl -n "$LEARNER_NS" get deploy "$GREEN" -o jsonpath='{.spec.template.metadata.labels.app}' 2>/dev/null || true)"
TPL_COLOR="$(kubectl -n "$LEARNER_NS" get deploy "$GREEN" -o jsonpath='{.spec.template.metadata.labels.color}' 2>/dev/null || true)"
IMAGE="$(kubectl -n "$LEARNER_NS" get deploy "$GREEN" -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || true)"
PORTS="$(kubectl -n "$LEARNER_NS" get deploy "$GREEN" -o jsonpath='{.spec.template.spec.containers[0].ports[*].containerPort}' 2>/dev/null || true)"

[[ "$TPL_APP" == "$WANT_APP" ]] || fail "green pod label app must be ${WANT_APP} (got '${TPL_APP}')"
[[ "$TPL_COLOR" == "$WANT_COLOR" ]] || fail "green pod label color must be ${WANT_COLOR} (got '${TPL_COLOR}')"
[[ "$IMAGE" == "$WANT_IMAGE" ]] || fail "green image must be ${WANT_IMAGE} (got '${IMAGE}')"

FOUND_PORT=0
for p in $PORTS; do
  [[ "$p" == "$WANT_PORT" ]] && FOUND_PORT=1 && break
done
[[ "$FOUND_PORT" -eq 1 ]] || fail "green containerPort must include ${WANT_PORT} (got '${PORTS}')"

if ! kubectl -n "$LEARNER_NS" get svc "$SVC" >/dev/null 2>&1; then
  fail "service/${SVC} not found in namespace ${LEARNER_NS}"
fi

SEL_APP="$(kubectl -n "$LEARNER_NS" get svc "$SVC" -o jsonpath='{.spec.selector.app}' 2>/dev/null || true)"
SEL_COLOR="$(kubectl -n "$LEARNER_NS" get svc "$SVC" -o jsonpath='{.spec.selector.color}' 2>/dev/null || true)"
[[ "$SEL_APP" == "$WANT_APP" ]] || fail "service selector app must be ${WANT_APP} (got '${SEL_APP}')"
[[ "$SEL_COLOR" == "$WANT_COLOR" ]] || fail "service selector color must be ${WANT_COLOR} (got '${SEL_COLOR}')"

# Soft: blue may be named payment-handler-blue or payment-handler (legacy)
BLUE_OK=0
for candidate in "$BLUE" payment-handler; do
  if kubectl -n "$LEARNER_NS" get deploy "$candidate" >/dev/null 2>&1; then
    B_READY="$(kubectl -n "$LEARNER_NS" get deploy "$candidate" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || true)"
    B_COLOR="$(kubectl -n "$LEARNER_NS" get deploy "$candidate" -o jsonpath='{.spec.template.metadata.labels.color}' 2>/dev/null || true)"
    if [[ "${B_READY:-0}" -ge 1 ]] && [[ "$candidate" != "$GREEN" ]]; then
      if [[ -z "$B_COLOR" || "$B_COLOR" == "blue" ]]; then
        BLUE_OK=1
        break
      fi
    fi
  fi
done
[[ "$BLUE_OK" -eq 1 ]] || fail "blue Deployment must remain Ready (rollback safety) and not be selected by the Service"

# Endpoints / EndpointSlices should only target green
EP_PODS="$(kubectl -n "$LEARNER_NS" get endpoints "$SVC" -o jsonpath='{.subsets[*].addresses[*].targetRef.name}' 2>/dev/null || true)"
if [[ -n "$EP_PODS" ]]; then
  for pod in $EP_PODS; do
    P_COLOR="$(kubectl -n "$LEARNER_NS" get pod "$pod" -o jsonpath='{.metadata.labels.color}' 2>/dev/null || true)"
    [[ "$P_COLOR" == "$WANT_COLOR" ]] || fail "Service endpoint pod/${pod} must be color=${WANT_COLOR} (got '${P_COLOR}')"
  done
fi

pass "blue-green cutover: ${GREEN} 3/3 Ready on ${WANT_IMAGE}; Service ${SVC} selects color=green; blue remains for rollback"
