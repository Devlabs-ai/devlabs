#!/usr/bin/env bash
# Grade k8s-18-provision-order-archive-disk — Order archive PV.
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

PV="order-archive-pv"

kubectl get pv "$PV" >/dev/null 2>&1 || fail "persistentvolume/${PV} not found"

CAP="$(kubectl get pv "$PV" -o jsonpath='{.spec.capacity.storage}' 2>/dev/null || true)"
AM="$(kubectl get pv "$PV" -o jsonpath='{.spec.accessModes[*]}' 2>/dev/null || true)"
RP="$(kubectl get pv "$PV" -o jsonpath='{.spec.persistentVolumeReclaimPolicy}' 2>/dev/null || true)"
SC="$(kubectl get pv "$PV" -o jsonpath='{.spec.storageClassName}' 2>/dev/null || true)"
VM="$(kubectl get pv "$PV" -o jsonpath='{.spec.volumeMode}' 2>/dev/null || true)"
HP="$(kubectl get pv "$PV" -o jsonpath='{.spec.hostPath.path}' 2>/dev/null || true)"
PHASE="$(kubectl get pv "$PV" -o jsonpath='{.status.phase}' 2>/dev/null || true)"

[[ "$CAP" == "1Gi" ]] || fail "capacity must be 1Gi (got '${CAP}')"
echo " $AM " | grep -Eq '(^| )ReadWriteOnce( |$)' || fail "accessModes must include ReadWriteOnce (got '${AM}')"
[[ "$RP" == "Retain" ]] || fail "reclaimPolicy must be Retain (got '${RP}')"
[[ "$SC" == "manual" ]] || fail "storageClassName must be manual (got '${SC}')"
[[ "${VM:-Filesystem}" == "Filesystem" ]] || fail "volumeMode must be Filesystem (got '${VM}')"
[[ "$HP" == "/mnt/data/order-archive" ]] || fail "hostPath must be /mnt/data/order-archive (got '${HP}')"
[[ "$PHASE" == "Available" || "$PHASE" == "Bound" ]] || fail "PV phase should be Available (got '${PHASE}')"

pass "persistentvolume/${PV} registered (phase=${PHASE})"
