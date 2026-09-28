#!/usr/bin/env bash
# Grade k8s-23-local-disk-for-hot-payment-writes — PVC pins platform local PV + mount.
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

PVC="payment-local-pvc"
DEP="payment-handler"
EXPECTED_PV="payment-local-pv-${LEARNER_NS}"

# Platform PV must still be the local volume (learners must not replace it with hostPath).
kubectl get pv "$EXPECTED_PV" >/dev/null 2>&1 || fail "platform persistentvolume/${EXPECTED_PV} not found"
LPATH="$(kubectl get pv "$EXPECTED_PV" -o jsonpath='{.spec.local.path}' 2>/dev/null || true)"
HP="$(kubectl get pv "$EXPECTED_PV" -o jsonpath='{.spec.hostPath.path}' 2>/dev/null || true)"
AFF_KEY="$(kubectl get pv "$EXPECTED_PV" -o jsonpath='{.spec.nodeAffinity.required.nodeSelectorTerms[0].matchExpressions[0].key}' 2>/dev/null || true)"
AFF_VAL="$(kubectl get pv "$EXPECTED_PV" -o jsonpath='{.spec.nodeAffinity.required.nodeSelectorTerms[0].matchExpressions[0].values[0]}' 2>/dev/null || true)"
EXPECTED_PATH="/mnt/local-ssd/payments-${LEARNER_NS}"
[[ -n "$LPATH" ]] || fail "platform PV must use local.path (not hostPath)"
[[ -z "$HP" ]] || fail "platform PV must not use hostPath"
[[ "$LPATH" == "$EXPECTED_PATH" ]] || fail "platform PV local.path must be ${EXPECTED_PATH} (got '${LPATH}')"
[[ "$AFF_KEY" == "quickbyte.ai/local-ssd" ]] || fail "platform PV node affinity key must be quickbyte.ai/local-ssd (got '${AFF_KEY}')"
[[ "$AFF_VAL" == "true" ]] || fail "platform PV node affinity value must be true (got '${AFF_VAL}')"

kubectl -n "$LEARNER_NS" get pvc "$PVC" >/dev/null 2>&1 || fail "pvc/${PVC} not found"
SC="$(kubectl -n "$LEARNER_NS" get pvc "$PVC" -o jsonpath='{.spec.storageClassName}' 2>/dev/null || true)"
REQ="$(kubectl -n "$LEARNER_NS" get pvc "$PVC" -o jsonpath='{.spec.resources.requests.storage}' 2>/dev/null || true)"
AM="$(kubectl -n "$LEARNER_NS" get pvc "$PVC" -o jsonpath='{.spec.accessModes[*]}' 2>/dev/null || true)"
VN="$(kubectl -n "$LEARNER_NS" get pvc "$PVC" -o jsonpath='{.spec.volumeName}' 2>/dev/null || true)"
PHASE="$(kubectl -n "$LEARNER_NS" get pvc "$PVC" -o jsonpath='{.status.phase}' 2>/dev/null || true)"

[[ "$SC" == "local-storage" ]] || fail "PVC storageClassName must be local-storage (got '${SC}')"
[[ "$REQ" == "500Mi" ]] || fail "PVC storage request must be 500Mi (got '${REQ}')"
echo " $AM " | grep -Eq '(^| )ReadWriteOnce( |$)' || fail "PVC accessModes must include ReadWriteOnce (got '${AM}')"
[[ "$VN" == "$EXPECTED_PV" ]] || fail "PVC volumeName must pin platform PV ${EXPECTED_PV} (got '${VN}')"
[[ "$PHASE" == "Bound" ]] || fail "PVC must be Bound (got '${PHASE}')"

kubectl -n "$LEARNER_NS" get deploy "$DEP" >/dev/null 2>&1 || fail "deployment/${DEP} not found"
REPLICAS="$(kubectl -n "$LEARNER_NS" get deploy "$DEP" -o jsonpath='{.spec.replicas}' 2>/dev/null || true)"
READY="$(kubectl -n "$LEARNER_NS" get deploy "$DEP" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || true)"
[[ "$REPLICAS" == "1" ]] || fail "replicas must be 1 (got '${REPLICAS}')"
[[ "${READY:-0}" == "1" ]] || fail "readyReplicas must be 1 (got '${READY:-0}')"

MP="$(kubectl -n "$LEARNER_NS" get deploy "$DEP" -o jsonpath='{.spec.template.spec.containers[0].volumeMounts[?(@.mountPath=="/var/log/payments")].mountPath}' 2>/dev/null || true)"
CLAIM="$(kubectl -n "$LEARNER_NS" get deploy "$DEP" -o jsonpath='{.spec.template.spec.volumes[*].persistentVolumeClaim.claimName}' 2>/dev/null || true)"
[[ "$MP" == "/var/log/payments" ]] || fail "must mount at /var/log/payments"
echo " $CLAIM " | grep -q "$PVC" || fail "deployment must use pvc/${PVC} (got '${CLAIM}')"

pass "pvc/${PVC} Bound to ${EXPECTED_PV} and deployment/${DEP} mounts it at /var/log/payments"
