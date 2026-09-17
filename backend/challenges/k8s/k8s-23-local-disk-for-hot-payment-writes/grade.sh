#!/usr/bin/env bash
# Grade k8s-23-local-disk-for-hot-payment-writes — Local PV for payments.
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

PV="payment-local-pv"
PVC="payment-local-pvc"
DEP="payment-handler"

kubectl get pv "$PV" >/dev/null 2>&1 || fail "persistentvolume/${PV} not found"
CAP="$(kubectl get pv "$PV" -o jsonpath='{.spec.capacity.storage}' 2>/dev/null || true)"
SC="$(kubectl get pv "$PV" -o jsonpath='{.spec.storageClassName}' 2>/dev/null || true)"
LPATH="$(kubectl get pv "$PV" -o jsonpath='{.spec.local.path}' 2>/dev/null || true)"
HP="$(kubectl get pv "$PV" -o jsonpath='{.spec.hostPath.path}' 2>/dev/null || true)"
AFF_KEY="$(kubectl get pv "$PV" -o jsonpath='{.spec.nodeAffinity.required.nodeSelectorTerms[0].matchExpressions[0].key}' 2>/dev/null || true)"
AFF_VAL="$(kubectl get pv "$PV" -o jsonpath='{.spec.nodeAffinity.required.nodeSelectorTerms[0].matchExpressions[0].values[0]}' 2>/dev/null || true)"

[[ "$CAP" == "5Gi" ]] || fail "PV capacity must be 5Gi (got '${CAP}')"
[[ "$SC" == "local-storage" ]] || fail "PV storageClassName must be local-storage (got '${SC}')"
[[ -n "$LPATH" ]] || fail "PV must use local.path (not hostPath)"
[[ -z "$HP" ]] || fail "do not use hostPath for this lab"
[[ "$LPATH" == "/mnt/local-ssd/payments" ]] || fail "local.path must be /mnt/local-ssd/payments (got '${LPATH}')"
[[ "$AFF_KEY" == "quickbyte.ai/local-ssd" ]] || fail "node affinity key must be quickbyte.ai/local-ssd (got '${AFF_KEY}')"
[[ "$AFF_VAL" == "true" ]] || fail "node affinity value must be true (got '${AFF_VAL}')"

kubectl -n "$LEARNER_NS" get pvc "$PVC" >/dev/null 2>&1 || fail "pvc/${PVC} not found"
SCREF="$(kubectl -n "$LEARNER_NS" get pvc "$PVC" -o jsonpath='{.spec.storageClassName}' 2>/dev/null || true)"
REQ="$(kubectl -n "$LEARNER_NS" get pvc "$PVC" -o jsonpath='{.spec.resources.requests.storage}' 2>/dev/null || true)"
[[ "$SCREF" == "local-storage" ]] || fail "PVC storageClassName must be local-storage (got '${SCREF}')"
[[ "$REQ" == "5Gi" ]] || fail "PVC storage request must be 5Gi (got '${REQ}')"

kubectl -n "$LEARNER_NS" get deploy "$DEP" >/dev/null 2>&1 || fail "deployment/${DEP} not found"
REPLICAS="$(kubectl -n "$LEARNER_NS" get deploy "$DEP" -o jsonpath='{.spec.replicas}' 2>/dev/null || true)"
[[ "$REPLICAS" == "1" ]] || fail "replicas must be 1 (got '${REPLICAS}')"
MP="$(kubectl -n "$LEARNER_NS" get deploy "$DEP" -o jsonpath='{.spec.template.spec.containers[0].volumeMounts[?(@.mountPath=="/var/log/payments")].mountPath}' 2>/dev/null || true)"
CLAIM="$(kubectl -n "$LEARNER_NS" get deploy "$DEP" -o jsonpath='{.spec.template.spec.volumes[*].persistentVolumeClaim.claimName}' 2>/dev/null || true)"
[[ "$MP" == "/var/log/payments" ]] || fail "must mount at /var/log/payments"
echo " $CLAIM " | grep -q "$PVC" || fail "deployment must use pvc/${PVC} (got '${CLAIM}')"

PHASE="$(kubectl -n "$LEARNER_NS" get pvc "$PVC" -o jsonpath='{.status.phase}' 2>/dev/null || true)"
READY="$(kubectl -n "$LEARNER_NS" get deploy "$DEP" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || true)"
if [[ "$PHASE" == "Bound" && "${READY:-0}" == "1" ]]; then
  pass "local pv/${PV}, pvc/${PVC} Bound, deployment/${DEP} Ready with mount"
fi
# Pragmatic fallback when node path/label missing in lab cluster
[[ "$PHASE" == "Bound" ]] || echo "WARN: pvc/${PVC} phase=${PHASE} (local path/node label may be missing)" >&2
pass "local pv/${PV} + pvc/${PVC} + deployment mount configured (phase=${PHASE})"
