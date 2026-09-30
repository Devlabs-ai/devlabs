#!/usr/bin/env bash
# Grade k8s-43-drain-order-processor-without-dropping-inflight — preStop + PDB.
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
PDB="order-processor-pdb"
WANT_REPLICAS="4"
WANT_GRACE="30"
WANT_MIN="3"
WANT_APP="order-processor"

if ! kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" >/dev/null 2>&1; then
  fail "deployment/${DEPLOY} not found"
fi

DESIRED="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.spec.replicas}' 2>/dev/null || true)"
READY="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || true)"
GRACE="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.spec.template.spec.terminationGracePeriodSeconds}' 2>/dev/null || true)"
PRESTOP="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.spec.template.spec.containers[0].lifecycle.preStop.exec.command[*]}' 2>/dev/null || true)"

[[ "$DESIRED" == "$WANT_REPLICAS" ]] || fail "replicas must be ${WANT_REPLICAS} (got '${DESIRED}')"
[[ "${READY:-0}" == "$WANT_REPLICAS" ]] || fail "readyReplicas must be ${WANT_REPLICAS} (got '${READY:-0}')"
[[ "$GRACE" == "$WANT_GRACE" ]] || fail "terminationGracePeriodSeconds must be ${WANT_GRACE} (got '${GRACE}')"
[[ -n "$PRESTOP" ]] || fail "container lifecycle preStop.exec.command must be set"
# Expect sleep 5 somewhere in the command
echo "$PRESTOP" | grep -q "sleep" || fail "preStop command should include sleep (got '${PRESTOP}')"
echo "$PRESTOP" | grep -Eq '5' || fail "preStop should sleep 5 seconds (got '${PRESTOP}')"

if ! kubectl -n "$LEARNER_NS" get pdb "$PDB" >/dev/null 2>&1; then
  fail "poddisruptionbudget/${PDB} not found"
fi

MIN="$(kubectl -n "$LEARNER_NS" get pdb "$PDB" -o jsonpath='{.spec.minAvailable}' 2>/dev/null || true)"
SEL="$(kubectl -n "$LEARNER_NS" get pdb "$PDB" -o jsonpath='{.spec.selector.matchLabels.app}' 2>/dev/null || true)"
[[ "$MIN" == "$WANT_MIN" ]] || fail "PDB minAvailable must be ${WANT_MIN} (got '${MIN}')"
[[ "$SEL" == "$WANT_APP" ]] || fail "PDB selector app must be ${WANT_APP} (got '${SEL}')"

pass "deploy/${DEPLOY} 4/4 with grace=${WANT_GRACE}s + preStop sleep; pdb/${PDB} minAvailable=${WANT_MIN}"
