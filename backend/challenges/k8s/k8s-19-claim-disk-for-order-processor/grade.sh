#!/usr/bin/env bash
# Grade k8s-19-claim-disk-for-order-processor — PVC + Order Processor mount.
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

PVC="order-archive-pvc"
DEP="order-processor-deploy"

kubectl -n "$LEARNER_NS" get pvc "$PVC" >/dev/null 2>&1 || fail "pvc/${PVC} not found"
SC="$(kubectl -n "$LEARNER_NS" get pvc "$PVC" -o jsonpath='{.spec.storageClassName}' 2>/dev/null || true)"
REQ="$(kubectl -n "$LEARNER_NS" get pvc "$PVC" -o jsonpath='{.spec.resources.requests.storage}' 2>/dev/null || true)"
AM="$(kubectl -n "$LEARNER_NS" get pvc "$PVC" -o jsonpath='{.spec.accessModes[*]}' 2>/dev/null || true)"
PHASE="$(kubectl -n "$LEARNER_NS" get pvc "$PVC" -o jsonpath='{.status.phase}' 2>/dev/null || true)"

[[ "$SC" == "manual" ]] || fail "PVC storageClassName must be manual (got '${SC}')"
[[ "$REQ" == "1Gi" ]] || fail "PVC storage request must be 1Gi (got '${REQ}')"
echo " $AM " | grep -Eq '(^| )ReadWriteOnce( |$)' || fail "PVC accessModes must include ReadWriteOnce (got '${AM}')"
[[ "$PHASE" == "Bound" ]] || fail "PVC must be Bound (got '${PHASE}')"

kubectl -n "$LEARNER_NS" get deploy "$DEP" >/dev/null 2>&1 || fail "deployment/${DEP} not found"
REPLICAS="$(kubectl -n "$LEARNER_NS" get deploy "$DEP" -o jsonpath='{.spec.replicas}' 2>/dev/null || true)"
READY="$(kubectl -n "$LEARNER_NS" get deploy "$DEP" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || true)"
[[ "$REPLICAS" == "1" ]] || fail "replicas must be 1 (got '${REPLICAS}')"
[[ "${READY:-0}" == "1" ]] || fail "readyReplicas must be 1 (got '${READY:-0}')"

CLAIM="$(kubectl -n "$LEARNER_NS" get deploy "$DEP" -o jsonpath='{.spec.template.spec.volumes[?(@.name=="archive")].persistentVolumeClaim.claimName}' 2>/dev/null || true)"
MP="$(kubectl -n "$LEARNER_NS" get deploy "$DEP" -o jsonpath='{.spec.template.spec.containers[0].volumeMounts[?(@.name=="archive")].mountPath}' 2>/dev/null || true)"
[[ "$CLAIM" == "$PVC" ]] || fail "volume archive must claim ${PVC} (got '${CLAIM}')"
[[ "$MP" == "/data/archive" ]] || fail "mountPath must be /data/archive (got '${MP}')"

pass "pvc/${PVC} Bound and deployment/${DEP} mounts it at /data/archive"
