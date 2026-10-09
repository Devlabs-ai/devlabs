#!/usr/bin/env bash
# Grade k8s-17-run-settlement-export-as-a-job — Settlement export Job.
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

JOB="settlement-export"
WANT_SA="settlement-exporter"

kubectl -n "$LEARNER_NS" get job "$JOB" >/dev/null 2>&1 || fail "job/${JOB} not found"

SA="$(kubectl -n "$LEARNER_NS" get job "$JOB" -o jsonpath='{.spec.template.spec.serviceAccountName}' 2>/dev/null || true)"
[[ "$SA" == "$WANT_SA" ]] || fail "serviceAccountName must be ${WANT_SA} (got '${SA:-default}')"

COMP="$(kubectl -n "$LEARNER_NS" get job "$JOB" -o jsonpath='{.spec.completions}' 2>/dev/null || true)"
[[ "${COMP:-1}" == "1" ]] || fail "completions must be 1 (got '${COMP}')"

RP="$(kubectl -n "$LEARNER_NS" get job "$JOB" -o jsonpath='{.spec.template.spec.restartPolicy}' 2>/dev/null || true)"
[[ "$RP" == "OnFailure" || "$RP" == "Never" ]] || fail "restartPolicy must be OnFailure or Never (got '${RP}')"

SUCC="$(kubectl -n "$LEARNER_NS" get job "$JOB" -o jsonpath='{.status.succeeded}' 2>/dev/null || true)"
[[ "${SUCC:-0}" -ge 1 ]] || fail "job/${JOB} must Complete (succeeded>=1, got '${SUCC:-0}')"

pass "job/${JOB} Completed using serviceAccountName=${WANT_SA} in ${LEARNER_NS}"
