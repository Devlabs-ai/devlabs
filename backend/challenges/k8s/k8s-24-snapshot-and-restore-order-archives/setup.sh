#!/usr/bin/env bash
# Baseline archive PV+PVC and best-effort VolumeSnapshotClass.
set -euo pipefail
: "${LEARNER_NS:?}"

if ! kubectl get pv order-archive-pv >/dev/null 2>&1; then
  kubectl apply -f - <<EOF
apiVersion: v1
kind: PersistentVolume
metadata:
  name: order-archive-pv
spec:
  capacity:
    storage: 1Gi
  accessModes: ["ReadWriteOnce"]
  persistentVolumeReclaimPolicy: Retain
  storageClassName: manual
  volumeMode: Filesystem
  hostPath:
    path: /mnt/data/order-archive-${LEARNER_NS}
EOF
fi

kubectl -n "$LEARNER_NS" apply -f - <<EOF
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: order-archive-pvc
spec:
  accessModes: ["ReadWriteOnce"]
  resources:
    requests:
      storage: 1Gi
  storageClassName: manual
EOF

# Best-effort snapshot class (driver name varies by cluster)
if kubectl api-resources 2>/dev/null | grep -q volumesnapshotclasses; then
  kubectl apply -f - <<'EOF' || true
apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshotClass
metadata:
  name: quickbyte-snapclass
driver: ebs.csi.aws.com
deletionPolicy: Delete
EOF
fi
echo "setup ok: ${CHALLENGE_ID:-lab} in ${LEARNER_NS}"
