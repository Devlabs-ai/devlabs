#!/usr/bin/env bash
# Grade k8s-22 — discover SC by namespace suffix + annotations; PVC + consumer Pod.
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

PVC="order-cache-pvc"
POD="cache-writer"

# Platform SC name ends with the learner namespace (learners discover via kubectl get sc).
# Use -- so a namespace like ns-admin does not look like grep flags (-ns-admin$).
SC="$(kubectl get sc -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null \
  | grep -E -- "-${LEARNER_NS}$" | head -1 || true)"
[[ -n "$SC" ]] || fail "no StorageClass whose name ends with -${LEARNER_NS} (did setup run?)"

SIZE_HINT="$(kubectl get sc "$SC" -o jsonpath='{.metadata.annotations.quickbyte\.ai/size-hint}' 2>/dev/null || true)"
MOUNT_HINT="$(kubectl get sc "$SC" -o jsonpath='{.metadata.annotations.quickbyte\.ai/mount-path}' 2>/dev/null || true)"
[[ -n "$SIZE_HINT" ]] || fail "StorageClass ${SC} missing annotation quickbyte.ai/size-hint"
[[ -n "$MOUNT_HINT" ]] || fail "StorageClass ${SC} missing annotation quickbyte.ai/mount-path"

kubectl -n "$LEARNER_NS" get pvc "$PVC" >/dev/null 2>&1 || fail "pvc/${PVC} not found"
SCREF="$(kubectl -n "$LEARNER_NS" get pvc "$PVC" -o jsonpath='{.spec.storageClassName}' 2>/dev/null || true)"
REQ="$(kubectl -n "$LEARNER_NS" get pvc "$PVC" -o jsonpath='{.spec.resources.requests.storage}' 2>/dev/null || true)"
AM="$(kubectl -n "$LEARNER_NS" get pvc "$PVC" -o jsonpath='{.spec.accessModes[*]}' 2>/dev/null || true)"
[[ "$SCREF" == "$SC" ]] || fail "PVC storageClassName must be discovered class ${SC} (got '${SCREF}')"
[[ "$REQ" == "$SIZE_HINT" ]] || fail "PVC storage request must match SC size-hint ${SIZE_HINT} (got '${REQ}')"
echo " $AM " | grep -Eq '(^| )ReadWriteOnce( |$)' || fail "PVC accessModes must include ReadWriteOnce (got '${AM}')"

BOUND_PV="$(kubectl -n "$LEARNER_NS" get pvc "$PVC" -o jsonpath='{.spec.volumeName}' 2>/dev/null || true)"
if [[ -n "$BOUND_PV" ]]; then
  HP="$(kubectl get pv "$BOUND_PV" -o jsonpath='{.spec.hostPath.path}' 2>/dev/null || true)"
  [[ -z "$HP" ]] || fail "do not hand-create a hostPath PV for this lab (PVC bound to ${BOUND_PV})"
fi

kubectl -n "$LEARNER_NS" get pod "$POD" >/dev/null 2>&1 || fail "pod/${POD} not found"
MP="$(kubectl -n "$LEARNER_NS" get pod "$POD" -o jsonpath='{.spec.containers[0].volumeMounts[?(@.name=="cache")].mountPath}' 2>/dev/null || true)"
CLAIM="$(kubectl -n "$LEARNER_NS" get pod "$POD" -o jsonpath='{.spec.volumes[?(@.name=="cache")].persistentVolumeClaim.claimName}' 2>/dev/null || true)"
IMG="$(kubectl -n "$LEARNER_NS" get pod "$POD" -o jsonpath='{.spec.containers[0].image}' 2>/dev/null || true)"
[[ "$MP" == "$MOUNT_HINT" ]] || fail "cache-writer mountPath must match SC mount-path ${MOUNT_HINT} (got '${MP}')"
[[ "$CLAIM" == "$PVC" ]] || fail "cache-writer must mount ${PVC} (got '${CLAIM}')"
[[ "$IMG" == "busybox:1.36" ]] || fail "cache-writer image must be busybox:1.36 (got '${IMG}')"

PHASE="$(kubectl -n "$LEARNER_NS" get pvc "$PVC" -o jsonpath='{.status.phase}' 2>/dev/null || true)"
if [[ "$PHASE" != "Bound" ]]; then
  echo "WARN: pvc/${PVC} phase is '${PHASE}' (CSI may be unavailable); structural checks passed" >&2
fi

pass "discovered sc/${SC} (size=${SIZE_HINT}, mount=${MOUNT_HINT}); pvc/${PVC} + pod/${POD} wired correctly"
