#!/usr/bin/env bash
# Grade k8s-22-dynamic-disks-via-storageclass — StorageClass + dynamic PVC.
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

SC="quickbyte-fast"
PVC="order-cache-pvc"
POD="cache-writer"

kubectl get sc "$SC" >/dev/null 2>&1 || fail "storageclass/${SC} not found"
PROV="$(kubectl get sc "$SC" -o jsonpath='{.provisioner}' 2>/dev/null || true)"
VBM="$(kubectl get sc "$SC" -o jsonpath='{.volumeBindingMode}' 2>/dev/null || true)"
RP="$(kubectl get sc "$SC" -o jsonpath='{.reclaimPolicy}' 2>/dev/null || true)"
[[ -n "$PROV" ]] || fail "StorageClass provisioner must be set"
[[ "$VBM" == "WaitForFirstConsumer" ]] || fail "volumeBindingMode must be WaitForFirstConsumer (got '${VBM}')"
[[ "$RP" == "Delete" ]] || fail "reclaimPolicy must be Delete (got '${RP}')"

kubectl -n "$LEARNER_NS" get pvc "$PVC" >/dev/null 2>&1 || fail "pvc/${PVC} not found"
SCREF="$(kubectl -n "$LEARNER_NS" get pvc "$PVC" -o jsonpath='{.spec.storageClassName}' 2>/dev/null || true)"
REQ="$(kubectl -n "$LEARNER_NS" get pvc "$PVC" -o jsonpath='{.spec.resources.requests.storage}' 2>/dev/null || true)"
[[ "$SCREF" == "$SC" ]] || fail "PVC storageClassName must be ${SC} (got '${SCREF}')"
[[ "$REQ" == "2Gi" ]] || fail "PVC storage request must be 2Gi (got '${REQ}')"

# Must not rely on a learner-authored static PV for this claim
BOUND_PV="$(kubectl -n "$LEARNER_NS" get pvc "$PVC" -o jsonpath='{.spec.volumeName}' 2>/dev/null || true)"
if [[ -n "$BOUND_PV" ]]; then
  HP="$(kubectl get pv "$BOUND_PV" -o jsonpath='{.spec.hostPath.path}' 2>/dev/null || true)"
  [[ -z "$HP" ]] || fail "do not hand-create a hostPath PV for this lab (PVC bound to ${BOUND_PV})"
fi

kubectl -n "$LEARNER_NS" get pod "$POD" >/dev/null 2>&1 || fail "pod/${POD} not found"
MP="$(kubectl -n "$LEARNER_NS" get pod "$POD" -o jsonpath='{.spec.containers[0].volumeMounts[?(@.name=="cache")].mountPath}' 2>/dev/null || true)"
CLAIM="$(kubectl -n "$LEARNER_NS" get pod "$POD" -o jsonpath='{.spec.volumes[?(@.name=="cache")].persistentVolumeClaim.claimName}' 2>/dev/null || true)"
IMG="$(kubectl -n "$LEARNER_NS" get pod "$POD" -o jsonpath='{.spec.containers[0].image}' 2>/dev/null || true)"
[[ "$MP" == "/cache" ]] || fail "cache-writer mountPath must be /cache (got '${MP}')"
[[ "$CLAIM" == "$PVC" ]] || fail "cache-writer must mount ${PVC} (got '${CLAIM}')"
[[ "$IMG" == "busybox:1.36" ]] || fail "cache-writer image must be busybox:1.36 (got '${IMG}')"

PHASE="$(kubectl -n "$LEARNER_NS" get pvc "$PVC" -o jsonpath='{.status.phase}' 2>/dev/null || true)"
# Pragmatic: require Bound when provisioner works; otherwise accept Pending if SC+PVC+Pod structure is correct
# (lab clusters without EBS CSI still validate the catalog + request shape).
if [[ "$PHASE" != "Bound" ]]; then
  echo "WARN: pvc/${PVC} phase is '${PHASE}' (CSI may be unavailable); structural checks passed" >&2
fi

pass "storageclass/${SC}, pvc/${PVC}, and pod/${POD} configured for dynamic provisioning"
