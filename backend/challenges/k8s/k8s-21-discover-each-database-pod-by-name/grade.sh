#!/usr/bin/env bash
# Grade k8s-21-discover-each-database-pod-by-name — orders-db headless Service.
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

SVC="orders-db"

kubectl -n "$LEARNER_NS" get svc "$SVC" >/dev/null 2>&1 || fail "service/${SVC} not found"
CIP="$(kubectl -n "$LEARNER_NS" get svc "$SVC" -o jsonpath='{.spec.clusterIP}' 2>/dev/null || true)"
[[ "$CIP" == "None" ]] || fail "clusterIP must be None (headless) (got '${CIP}')"

SEL="$(kubectl -n "$LEARNER_NS" get svc "$SVC" -o jsonpath='{.spec.selector.app}' 2>/dev/null || true)"
[[ "$SEL" == "orders-db" ]] || fail "selector.app must be orders-db (got '${SEL}')"

PNAME="$(kubectl -n "$LEARNER_NS" get svc "$SVC" -o jsonpath='{.spec.ports[0].name}' 2>/dev/null || true)"
PORT="$(kubectl -n "$LEARNER_NS" get svc "$SVC" -o jsonpath='{.spec.ports[0].port}' 2>/dev/null || true)"
TP="$(kubectl -n "$LEARNER_NS" get svc "$SVC" -o jsonpath='{.spec.ports[0].targetPort}' 2>/dev/null || true)"
[[ "$PNAME" == "postgres" ]] || fail "port name must be postgres (got '${PNAME}')"
[[ "$PORT" == "5432" ]] || fail "port must be 5432 (got '${PORT}')"
[[ "$TP" == "5432" ]] || fail "targetPort must be 5432 (got '${TP}')"

# Endpoints / EndpointSlice — accept either API
EPS="$(kubectl -n "$LEARNER_NS" get endpoints "$SVC" -o jsonpath='{.subsets[*].addresses[*].hostname}' 2>/dev/null || true)"
EPS_IP="$(kubectl -n "$LEARNER_NS" get endpoints "$SVC" -o jsonpath='{.subsets[*].addresses[*].ip}' 2>/dev/null || true)"
COUNT=0
for h in $EPS; do COUNT=$((COUNT+1)); done
if [[ "$COUNT" -lt 2 ]]; then
  # count IPs if hostnames empty
  COUNT=0
  for ip in $EPS_IP; do COUNT=$((COUNT+1)); done
fi
[[ "$COUNT" -ge 2 ]] || fail "endpoints must include both orders-db pods (got ${COUNT} addresses)"

# Prefer seeing named pods when hostname present
if [[ -n "$EPS" ]]; then
  echo " $EPS " | grep -q "orders-db-0" || fail "endpoints should include orders-db-0 (got '${EPS}')"
  echo " $EPS " | grep -q "orders-db-1" || fail "endpoints should include orders-db-1 (got '${EPS}')"
fi

pass "headless service/${SVC} has no ClusterIP and lists database Pod endpoints"
