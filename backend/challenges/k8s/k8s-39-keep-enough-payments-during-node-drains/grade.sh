#!/usr/bin/env bash
# Grade k8s-39-keep-enough-payments-during-node-drains — PDB minAvailable.
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

PDB="payment-handler-pdb"
WANT_MIN="3"
WANT_APP="payment-handler"

if ! kubectl -n "$LEARNER_NS" get pdb "$PDB" >/dev/null 2>&1; then
  fail "poddisruptionbudget/${PDB} not found"
fi

MIN="$(kubectl -n "$LEARNER_NS" get pdb "$PDB" -o jsonpath='{.spec.minAvailable}' 2>/dev/null || true)"
MAX_UN="$(kubectl -n "$LEARNER_NS" get pdb "$PDB" -o jsonpath='{.spec.maxUnavailable}' 2>/dev/null || true)"
SEL="$(kubectl -n "$LEARNER_NS" get pdb "$PDB" -o jsonpath='{.spec.selector.matchLabels.app}' 2>/dev/null || true)"

[[ -n "$MAX_UN" ]] && fail "use minAvailable (not maxUnavailable) for this lab (got maxUnavailable='${MAX_UN}')"
[[ "$MIN" == "$WANT_MIN" ]] || fail "minAvailable must be ${WANT_MIN} (got '${MIN}')"
[[ "$SEL" == "$WANT_APP" ]] || fail "selector app must be ${WANT_APP} (got '${SEL}')"

pass "pdb/${PDB} selects app=${WANT_APP} with minAvailable=${WANT_MIN} in ${LEARNER_NS}"
