#!/usr/bin/env bash
# Grade k8s-10-firewall-rules-between-order-and-payment — Payment Handler NetworkPolicy.
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

NP="payment-handler-allow-orders"

if ! kubectl -n "$LEARNER_NS" get networkpolicy "$NP" >/dev/null 2>&1; then
  fail "networkpolicy/${NP} not found in namespace ${LEARNER_NS}"
fi

SEL="$(kubectl -n "$LEARNER_NS" get networkpolicy "$NP" -o jsonpath='{.spec.podSelector.matchLabels.app}' 2>/dev/null || true)"
[[ "$SEL" == "payment-handler" ]] || fail "podSelector app must be payment-handler (got '${SEL}')"

TYPES="$(kubectl -n "$LEARNER_NS" get networkpolicy "$NP" -o jsonpath='{.spec.policyTypes[*]}' 2>/dev/null || true)"
echo "$TYPES" | grep -qw "Ingress" || fail "policyTypes must include Ingress (got '${TYPES}')"

FROM_APP="$(kubectl -n "$LEARNER_NS" get networkpolicy "$NP" -o jsonpath='{.spec.ingress[*].from[*].podSelector.matchLabels.app}' 2>/dev/null || true)"
echo "$FROM_APP" | grep -qw "order-processor" || fail "ingress from must include podSelector app=order-processor (got '${FROM_APP}')"

PORT="$(kubectl -n "$LEARNER_NS" get networkpolicy "$NP" -o jsonpath='{.spec.ingress[*].ports[*].port}' 2>/dev/null || true)"
PROTO="$(kubectl -n "$LEARNER_NS" get networkpolicy "$NP" -o jsonpath='{.spec.ingress[*].ports[*].protocol}' 2>/dev/null || true)"
echo "$PORT" | grep -qw "8000" || fail "ingress ports must include 8000 (got '${PORT}')"
# protocol may be empty (defaults TCP) or TCP
if [[ -n "$PROTO" ]]; then
  echo "$PROTO" | grep -qw "TCP" || fail "ingress protocol must be TCP (got '${PROTO}')"
fi

pass "networkpolicy/${NP} allows order-processor → payment-handler:8000/TCP in ${LEARNER_NS}"
