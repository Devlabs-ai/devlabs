#!/usr/bin/env bash
# Grade k8s-32-package-notification-service-with-helm — Helm chart install.
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
SVC="notification-service"
WANT_REPLICAS="2"
WANT_IMAGE="rithvikreddyalkanti/notification-service:v1.0"
WANT_APP="notification-service"
WANT_PORT="8080"
RELEASE="notifications"

if ! kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" >/dev/null 2>&1; then
  fail "deployment/${DEPLOY} not found — install the Helm chart (release ${RELEASE})"
fi

DESIRED="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.spec.replicas}' 2>/dev/null || true)"
READY="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || true)"
[[ "$DESIRED" == "$WANT_REPLICAS" ]] || fail "replicas must be ${WANT_REPLICAS} (got '${DESIRED}')"
[[ "${READY:-0}" == "$WANT_REPLICAS" ]] || fail "readyReplicas must be ${WANT_REPLICAS} (got '${READY:-0}')"

TPL_APP="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.spec.template.metadata.labels.app}' 2>/dev/null || true)"
IMAGE="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || true)"
PORTS="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.spec.template.spec.containers[0].ports[*].containerPort}' 2>/dev/null || true)"

[[ "$TPL_APP" == "$WANT_APP" ]] || fail "pod label app must be ${WANT_APP} (got '${TPL_APP}')"
[[ "$IMAGE" == "$WANT_IMAGE" ]] || fail "image must be ${WANT_IMAGE} (got '${IMAGE}')"
FOUND_PORT=0
for p in $PORTS; do [[ "$p" == "$WANT_PORT" ]] && FOUND_PORT=1 && break; done
[[ "$FOUND_PORT" -eq 1 ]] || fail "containerPort must include ${WANT_PORT} (got '${PORTS}')"

if ! kubectl -n "$LEARNER_NS" get svc "$SVC" >/dev/null 2>&1; then
  fail "service/${SVC} not found"
fi
SEL="$(kubectl -n "$LEARNER_NS" get svc "$SVC" -o jsonpath='{.spec.selector.app}' 2>/dev/null || true)"
SVC_PORT="$(kubectl -n "$LEARNER_NS" get svc "$SVC" -o jsonpath='{.spec.ports[0].port}' 2>/dev/null || true)"
SVC_TYPE="$(kubectl -n "$LEARNER_NS" get svc "$SVC" -o jsonpath='{.spec.type}' 2>/dev/null || true)"
[[ "$SEL" == "$WANT_APP" ]] || fail "service selector app must be ${WANT_APP} (got '${SEL}')"
[[ "$SVC_PORT" == "$WANT_PORT" ]] || fail "service port must be ${WANT_PORT} (got '${SVC_PORT}')"
[[ -z "$SVC_TYPE" || "$SVC_TYPE" == "ClusterIP" ]] || fail "service type must be ClusterIP (got '${SVC_TYPE}')"

SOFT=""
if command -v helm >/dev/null 2>&1; then
  STATUS="$(helm status "$RELEASE" -n "$LEARNER_NS" -o json 2>/dev/null | sed -n 's/.*"status":"\([^"]*\)".*/\1/p' | head -1 || true)"
  if [[ -z "$STATUS" ]]; then
    # fallback parse
    STATUS="$(helm status "$RELEASE" -n "$LEARNER_NS" 2>/dev/null | awk '/STATUS:/ {print $2; exit}' || true)"
  fi
  if [[ -n "$STATUS" ]]; then
    [[ "$STATUS" == "deployed" ]] || fail "Helm release ${RELEASE} STATUS must be deployed (got '${STATUS}')"
  else
    SOFT=" (soft: Helm release '${RELEASE}' not found — graded Deployment/Service only)"
  fi
else
  SOFT=" (soft: helm CLI absent — graded rendered workloads only)"
fi

pass "Helm chart workloads Ready: deploy/${DEPLOY} ${WANT_REPLICAS}/${WANT_REPLICAS}, Service ${SVC}:${WANT_PORT}${SOFT}"
