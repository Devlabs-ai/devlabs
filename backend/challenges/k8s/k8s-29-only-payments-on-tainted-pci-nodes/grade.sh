#!/usr/bin/env bash
# Grade k8s-29-only-payments-on-tainted-pci-nodes — payment PCI toleration.
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

DEP="payment-handler"

kubectl -n "$LEARNER_NS" get deploy "$DEP" >/dev/null 2>&1 || fail "deployment/${DEP} not found"
REPLICAS="$(kubectl -n "$LEARNER_NS" get deploy "$DEP" -o jsonpath='{.spec.replicas}' 2>/dev/null || true)"
[[ "$REPLICAS" == "2" ]] || fail "replicas must be 2 (got '${REPLICAS}')"

# Find pci toleration
FOUND=0
KEYS="$(kubectl -n "$LEARNER_NS" get deploy "$DEP" -o jsonpath='{range .spec.template.spec.tolerations[*]}{.key}{"|"}{.operator}{"|"}{.value}{"|"}{.effect}{"\n"}{end}' 2>/dev/null || true)"
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  [[ "$line" == "pci|Equal|true|NoSchedule" || "$line" == "pci|Equal|true|NoSchedule" ]] && FOUND=1
  # case-insensitive operator Equal
  key="$(echo "$line" | cut -d'|' -f1)"
  op="$(echo "$line" | cut -d'|' -f2 | tr '[:upper:]' '[:lower:]')"
  val="$(echo "$line" | cut -d'|' -f3)"
  eff="$(echo "$line" | cut -d'|' -f4)"
  if [[ "$key" == "pci" && "$op" == "equal" && "$val" == "true" && "$eff" == "NoSchedule" ]]; then
    FOUND=1
  fi
done <<< "$KEYS"
[[ "$FOUND" -eq 1 ]] || fail "must tolerate pci=true:NoSchedule (got '${KEYS}')"

# Notification must not have PCI toleration if present
if kubectl -n "$LEARNER_NS" get deploy notification-service >/dev/null 2>&1; then
  NKEYS="$(kubectl -n "$LEARNER_NS" get deploy notification-service -o jsonpath='{range .spec.template.spec.tolerations[*]}{.key}{"\n"}{end}' 2>/dev/null || true)"
  echo "$NKEYS" | grep -qx "pci" && fail "do not add PCI toleration to notification-service"
fi

READY="$(kubectl -n "$LEARNER_NS" get deploy "$DEP" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || true)"
[[ "${READY:-0}" == "2" ]] || fail "readyReplicas must be 2 (got '${READY:-0}')"

pass "deployment/${DEP} tolerates pci=true:NoSchedule (2/2 Ready)"
