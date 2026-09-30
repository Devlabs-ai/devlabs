#!/usr/bin/env bash
# Grade k8s-16-identity-for-settlement-export — Settlement SA + RBAC.
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

SA="settlement-exporter"
ROLE="settlement-exporter-pod-reader"
RB="settlement-exporter-pod-reader"

kubectl -n "$LEARNER_NS" get sa "$SA" >/dev/null 2>&1 || fail "serviceaccount/${SA} not found"
kubectl -n "$LEARNER_NS" get role "$ROLE" >/dev/null 2>&1 || fail "role/${ROLE} not found"
kubectl -n "$LEARNER_NS" get rolebinding "$RB" >/dev/null 2>&1 || fail "rolebinding/${RB} not found"

VERBS="$(kubectl -n "$LEARNER_NS" get role "$ROLE" -o jsonpath='{.rules[0].verbs[*]}' 2>/dev/null || true)"
RESOURCES="$(kubectl -n "$LEARNER_NS" get role "$ROLE" -o jsonpath='{.rules[0].resources[*]}' 2>/dev/null || true)"

echo " ${VERBS} " | grep -Eq '(^|[[:space:]])get([[:space:]]|$)' || fail "Role must allow get (got '${VERBS}')"
echo " ${VERBS} " | grep -Eq '(^|[[:space:]])list([[:space:]]|$)' || fail "Role must allow list (got '${VERBS}')"
echo " ${RESOURCES} " | grep -Eq '(^|[[:space:]])pods([[:space:]]|$)' || fail "Role resources must include pods (got '${RESOURCES}')"

REF_KIND="$(kubectl -n "$LEARNER_NS" get rolebinding "$RB" -o jsonpath='{.roleRef.kind}' 2>/dev/null || true)"
REF_NAME="$(kubectl -n "$LEARNER_NS" get rolebinding "$RB" -o jsonpath='{.roleRef.name}' 2>/dev/null || true)"
SUB_KIND="$(kubectl -n "$LEARNER_NS" get rolebinding "$RB" -o jsonpath='{.subjects[0].kind}' 2>/dev/null || true)"
SUB_NAME="$(kubectl -n "$LEARNER_NS" get rolebinding "$RB" -o jsonpath='{.subjects[0].name}' 2>/dev/null || true)"

[[ "$REF_KIND" == "Role" ]] || fail "roleRef.kind must be Role (got '${REF_KIND}')"
[[ "$REF_NAME" == "$ROLE" ]] || fail "roleRef.name must be ${ROLE} (got '${REF_NAME}')"
[[ "$SUB_KIND" == "ServiceAccount" ]] || fail "subject kind must be ServiceAccount (got '${SUB_KIND}')"
[[ "$SUB_NAME" == "$SA" ]] || fail "subject name must be ${SA} (got '${SUB_NAME}')"

# Reject ClusterRole with same name if learner wrongly used one bound at cluster scope for this binding
pass "SA/${SA}, Role/${ROLE}, and RoleBinding/${RB} grant get/list pods in ${LEARNER_NS}"
