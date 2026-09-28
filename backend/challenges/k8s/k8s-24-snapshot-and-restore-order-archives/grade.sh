#!/usr/bin/env bash
# Grade k8s-24-snapshot-and-restore-order-archives — VolumeSnapshot + restore PVC.
# Does NOT require archive-restore-check Pod or live readyToUse/Bound (optional checks).
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

SNAP="order-archive-snap"
SRC_PVC="order-archive-pvc"
RST_PVC="order-archive-pvc-restore"

# Original claim must still exist
kubectl -n "$LEARNER_NS" get pvc "$SRC_PVC" >/dev/null 2>&1 || fail "original pvc/${SRC_PVC} must still exist"

if ! kubectl -n "$LEARNER_NS" get volumesnapshot "$SNAP" >/dev/null 2>&1; then
  fail "volumesnapshot/${SNAP} not found (is the snapshot.storage.k8s.io API installed?)"
fi

VSC="$(kubectl -n "$LEARNER_NS" get volumesnapshot "$SNAP" -o jsonpath='{.spec.volumeSnapshotClassName}' 2>/dev/null || true)"
SRC="$(kubectl -n "$LEARNER_NS" get volumesnapshot "$SNAP" -o jsonpath='{.spec.source.persistentVolumeClaimName}' 2>/dev/null || true)"
[[ "$VSC" == "quickbyte-snapclass" ]] || fail "volumeSnapshotClassName must be quickbyte-snapclass (got '${VSC}')"
[[ "$SRC" == "$SRC_PVC" ]] || fail "snapshot source PVC must be ${SRC_PVC} (got '${SRC}')"

kubectl -n "$LEARNER_NS" get pvc "$RST_PVC" >/dev/null 2>&1 || fail "pvc/${RST_PVC} not found"
DS_NAME="$(kubectl -n "$LEARNER_NS" get pvc "$RST_PVC" -o jsonpath='{.spec.dataSource.name}' 2>/dev/null || true)"
DS_KIND="$(kubectl -n "$LEARNER_NS" get pvc "$RST_PVC" -o jsonpath='{.spec.dataSource.kind}' 2>/dev/null || true)"
DS_API="$(kubectl -n "$LEARNER_NS" get pvc "$RST_PVC" -o jsonpath='{.spec.dataSource.apiGroup}' 2>/dev/null || true)"
REQ="$(kubectl -n "$LEARNER_NS" get pvc "$RST_PVC" -o jsonpath='{.spec.resources.requests.storage}' 2>/dev/null || true)"
RST_SC="$(kubectl -n "$LEARNER_NS" get pvc "$RST_PVC" -o jsonpath='{.spec.storageClassName}' 2>/dev/null || true)"
[[ "$DS_NAME" == "$SNAP" ]] || fail "restored PVC dataSource.name must be ${SNAP} (got '${DS_NAME}')"
[[ "$DS_KIND" == "VolumeSnapshot" ]] || fail "dataSource.kind must be VolumeSnapshot (got '${DS_KIND}')"
[[ "$DS_API" == "snapshot.storage.k8s.io" ]] || fail "dataSource.apiGroup must be snapshot.storage.k8s.io (got '${DS_API}')"
[[ "$REQ" == "500Mi" ]] || fail "restored PVC storage must be 500Mi (got '${REQ}')"
[[ "$RST_SC" == "gp2" ]] || fail "restored PVC storageClassName must be gp2 (got '${RST_SC}')"

# Optional runtime checks — informational only (do not fail Submit)
READY="$(kubectl -n "$LEARNER_NS" get volumesnapshot "$SNAP" -o jsonpath='{.status.readyToUse}' 2>/dev/null || true)"
PHASE="$(kubectl -n "$LEARNER_NS" get pvc "$RST_PVC" -o jsonpath='{.status.phase}' 2>/dev/null || true)"
if kubectl -n "$LEARNER_NS" get pod archive-restore-check >/dev/null 2>&1; then
  echo "INFO: optional pod/archive-restore-check present (not required)" >&2
fi
if [[ "$READY" == "true" && "$PHASE" == "Bound" ]]; then
  echo "INFO: snapshot readyToUse=true and restore pvc Bound (nice-to-have)" >&2
else
  echo "INFO: optional runtime check — readyToUse='${READY}' restore phase='${PHASE}' (not graded)" >&2
fi

pass "volumesnapshot/${SNAP} and restore pvc/${RST_PVC} configured from ${SRC_PVC}"
