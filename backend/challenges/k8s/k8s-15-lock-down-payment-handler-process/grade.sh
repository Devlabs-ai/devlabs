#!/usr/bin/env bash
# Grade k8s-15-lock-down-payment-handler-process — Payment Handler securityContext.
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

DEPLOY="payment-handler"
WANT_REPLICAS="2"

if ! kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" >/dev/null 2>&1; then
  fail "deployment/${DEPLOY} not found"
fi

DESIRED="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.spec.replicas}' 2>/dev/null || true)"
READY="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || true)"
[[ "$DESIRED" == "$WANT_REPLICAS" ]] || fail "replicas must be ${WANT_REPLICAS} (got '${DESIRED}')"
[[ "${READY:-0}" == "$WANT_REPLICAS" ]] || fail "readyReplicas must be ${WANT_REPLICAS} (got '${READY:-0}')"

# Prefer container named payment-handler; fall back to [0]
CNAME="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.spec.template.spec.containers[0].name}' 2>/dev/null || true)"
SC_JSON="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.spec.template.spec.containers[0].securityContext}' 2>/dev/null || true)"
[[ -n "$SC_JSON" ]] || fail "container securityContext must be set"

RUN_NR="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.spec.template.spec.containers[0].securityContext.runAsNonRoot}' 2>/dev/null || true)"
RUN_UID="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.spec.template.spec.containers[0].securityContext.runAsUser}' 2>/dev/null || true)"
ALLOW_PE="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.spec.template.spec.containers[0].securityContext.allowPrivilegeEscalation}' 2>/dev/null || true)"
RO_ROOT="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.spec.template.spec.containers[0].securityContext.readOnlyRootFilesystem}' 2>/dev/null || true)"
CAPS="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.spec.template.spec.containers[0].securityContext.capabilities.drop[*]}' 2>/dev/null || true)"
PRIV="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.spec.template.spec.containers[0].securityContext.privileged}' 2>/dev/null || true)"

[[ "$RUN_NR" == "true" ]] || fail "runAsNonRoot must be true (got '${RUN_NR}')"
[[ "$RUN_UID" == "1000" ]] || fail "runAsUser must be 1000 (got '${RUN_UID}')"
[[ "$ALLOW_PE" == "false" ]] || fail "allowPrivilegeEscalation must be false (got '${ALLOW_PE}')"
[[ "$RO_ROOT" == "true" ]] || fail "readOnlyRootFilesystem must be true (got '${RO_ROOT}')"
echo "$CAPS" | grep -qw "ALL" || fail "capabilities.drop must include ALL (got '${CAPS}')"
[[ "$PRIV" != "true" ]] || fail "privileged must not be true"

READY_PODS=0
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  name="$(echo "$line" | awk '{print $1}')"
  ready="$(echo "$line" | awk '{print $2}')"
  phase="$(echo "$line" | awk '{print $3}')"
  [[ "$phase" == "Running" ]] || fail "pod/${name} phase must be Running (got '${phase}')"
  [[ "$ready" == "1/1" ]] || fail "pod/${name} must be Ready 1/1 (got '${ready}')"
  READY_PODS=$((READY_PODS + 1))
done < <(kubectl -n "$LEARNER_NS" get pods -l app=payment-handler --no-headers 2>/dev/null || true)
[[ "$READY_PODS" -ge "$WANT_REPLICAS" ]] || fail "need ${WANT_REPLICAS} Ready pods (got ${READY_PODS})"

pass "deployment/${DEPLOY} hardened with securityContext in ${LEARNER_NS}"
