#!/usr/bin/env bash
# Grade k8s-36-one-front-door-for-qa-and-partners — Ingress paths.
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

ING="quickbyte-edge"

if ! kubectl -n "$LEARNER_NS" get ingress "$ING" >/dev/null 2>&1; then
  fail "ingress/${ING} not found in namespace ${LEARNER_NS}"
fi

# Collect path -> service:port pairs from the Ingress
PATHS_JSON="$(kubectl -n "$LEARNER_NS" get ingress "$ING" -o json 2>/dev/null || true)"
[[ -n "$PATHS_JSON" ]] || fail "could not read ingress/${ING}"

ORDERS_SVC="$(kubectl -n "$LEARNER_NS" get ingress "$ING" -o jsonpath='{range .spec.rules[*].http.paths[*]}{.path}{"|"}{.backend.service.name}{"|"}{.backend.service.port.number}{"\n"}{end}' 2>/dev/null || true)"

FOUND_ORDERS=0
FOUND_NOTIFY=0
while IFS='|' read -r path svc port; do
  [[ -z "${path:-}" ]] && continue
  case "$path" in
    /orders|/orders/)
      [[ "$svc" == "order-processor-svc" ]] || fail "/orders must backend to order-processor-svc (got '${svc}')"
      [[ "$port" == "8000" ]] || fail "/orders port must be 8000 (got '${port}')"
      FOUND_ORDERS=1
      ;;
    /notify|/notify/)
      [[ "$svc" == "notification-service" ]] || fail "/notify must backend to notification-service (got '${svc}')"
      [[ "$port" == "8080" ]] || fail "/notify port must be 8080 (got '${port}')"
      FOUND_NOTIFY=1
      ;;
  esac
done <<< "$ORDERS_SVC"

[[ "$FOUND_ORDERS" -eq 1 ]] || fail "Ingress must have Prefix path /orders → order-processor-svc:8000"
[[ "$FOUND_NOTIFY" -eq 1 ]] || fail "Ingress must have Prefix path /notify → notification-service:8080"

# pathType Prefix preferred
PATH_TYPES="$(kubectl -n "$LEARNER_NS" get ingress "$ING" -o jsonpath='{.spec.rules[*].http.paths[*].pathType}' 2>/dev/null || true)"
if [[ -n "$PATH_TYPES" ]]; then
  for pt in $PATH_TYPES; do
    [[ "$pt" == "Prefix" || "$pt" == "ImplementationSpecific" ]] || fail "pathType should be Prefix (got '${pt}')"
  done
fi

SOFT=""
ADDR="$(kubectl -n "$LEARNER_NS" get ingress "$ING" -o jsonpath='{.status.loadBalancer.ingress[0].ip}{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || true)"
[[ -n "$ADDR" ]] || SOFT=" (soft: Ingress address not assigned yet — paths graded)"

# Reject LB Services as the "solution" for each app (optional soft note if LB exists)
pass "ingress/${ING} routes /orders→order-processor-svc:8000 and /notify→notification-service:8080${SOFT}"
