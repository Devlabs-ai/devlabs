#!/usr/bin/env bash
# Grade k8s-34-nightly-order-reconciliation-job — Job + CronJob.
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

JOB="order-reconciliation-manual"
CRON="order-reconciliation-nightly"
WANT_IMAGE="rithvikreddyalkanti/order-reconciliation:v1.0"
WANT_SCHEDULE="15 1 * * *"
WANT_POLICY="Forbid"

if kubectl -n "$LEARNER_NS" get deploy "$JOB" >/dev/null 2>&1; then
  fail "found Deployment/${JOB} — use a Job, not a Deployment"
fi

if ! kubectl -n "$LEARNER_NS" get job "$JOB" >/dev/null 2>&1; then
  fail "job/${JOB} not found in namespace ${LEARNER_NS}"
fi

JOB_IMAGE="$(kubectl -n "$LEARNER_NS" get job "$JOB" -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || true)"
COMPLETIONS="$(kubectl -n "$LEARNER_NS" get job "$JOB" -o jsonpath='{.spec.completions}' 2>/dev/null || true)"
SUCCEEDED="$(kubectl -n "$LEARNER_NS" get job "$JOB" -o jsonpath='{.status.succeeded}' 2>/dev/null || true)"
RESTART="$(kubectl -n "$LEARNER_NS" get job "$JOB" -o jsonpath='{.spec.template.spec.restartPolicy}' 2>/dev/null || true)"

[[ "$JOB_IMAGE" == "$WANT_IMAGE" ]] || fail "Job image must be ${WANT_IMAGE} (got '${JOB_IMAGE}')"
[[ "${COMPLETIONS:-1}" == "1" ]] || fail "Job completions must be 1 (got '${COMPLETIONS}')"
[[ "${SUCCEEDED:-0}" == "1" ]] || fail "Job must be Complete (succeeded=1, got '${SUCCEEDED:-0}')"
case "$RESTART" in
  OnFailure|Never) ;;
  *) fail "Job restartPolicy must be OnFailure or Never (got '${RESTART}')" ;;
esac

if ! kubectl -n "$LEARNER_NS" get cronjob "$CRON" >/dev/null 2>&1; then
  fail "cronjob/${CRON} not found"
fi

SCHEDULE="$(kubectl -n "$LEARNER_NS" get cronjob "$CRON" -o jsonpath='{.spec.schedule}' 2>/dev/null || true)"
POLICY="$(kubectl -n "$LEARNER_NS" get cronjob "$CRON" -o jsonpath='{.spec.concurrencyPolicy}' 2>/dev/null || true)"
CRON_IMAGE="$(kubectl -n "$LEARNER_NS" get cronjob "$CRON" -o jsonpath='{.spec.jobTemplate.spec.template.spec.containers[0].image}' 2>/dev/null || true)"

[[ "$SCHEDULE" == "$WANT_SCHEDULE" ]] || fail "CronJob schedule must be '${WANT_SCHEDULE}' (got '${SCHEDULE}')"
[[ "$POLICY" == "$WANT_POLICY" ]] || fail "concurrencyPolicy must be ${WANT_POLICY} (got '${POLICY}')"
[[ "$CRON_IMAGE" == "$WANT_IMAGE" ]] || fail "CronJob image must be ${WANT_IMAGE} (got '${CRON_IMAGE}')"

pass "job/${JOB} Complete and cronjob/${CRON} scheduled '${WANT_SCHEDULE}' with Forbid in ${LEARNER_NS}"
