#!/usr/bin/env bash
# Baseline archive PVC on gp2 (EBS CSI) + seed Pod so WaitForFirstConsumer binds,
# plus best-effort VolumeSnapshotClass. Learners create the VolumeSnapshot themselves.
set -euo pipefail
: "${LEARNER_NS:?}"

heal_archive_pvc() {
  local phase sc
  phase="$(kubectl -n "$LEARNER_NS" get pvc order-archive-pvc -o jsonpath='{.status.phase}' 2>/dev/null || true)"
  sc="$(kubectl -n "$LEARNER_NS" get pvc order-archive-pvc -o jsonpath='{.spec.storageClassName}' 2>/dev/null || true)"
  if [[ -z "$phase" ]]; then
    return 0
  fi
  if [[ "$phase" == "Lost" || "$sc" != "gp2" ]]; then
    echo "healing: removing broken pvc/order-archive-pvc (phase=${phase:-?} sc=${sc:-?})"
    kubectl -n "$LEARNER_NS" delete pod archive-seed --ignore-not-found --wait=false >/dev/null 2>&1 || true
    kubectl -n "$LEARNER_NS" delete pvc order-archive-pvc --ignore-not-found --wait=true
  fi
}

heal_archive_pvc
kubectl delete pv order-archive-pv --ignore-not-found --wait=false >/dev/null 2>&1 || true

kubectl -n "$LEARNER_NS" apply -f - <<EOF
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: order-archive-pvc
  labels:
    app.kubernetes.io/part-of: devlabs
    devlabs.ai/lab: snapshot-restore
    devlabs.ai/learner-ns: ${LEARNER_NS}
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 500Mi
  storageClassName: gp2
---
# gp2 is WaitForFirstConsumer — a consumer Pod is required before the PVC Binds.
apiVersion: v1
kind: Pod
metadata:
  name: archive-seed
  labels:
    app.kubernetes.io/part-of: devlabs
    app.kubernetes.io/component: archive-seed
    devlabs.ai/lab: snapshot-restore
spec:
  containers:
    - name: seed
      image: public.ecr.aws/docker/library/busybox:1.36
      command: ["sh", "-c", "echo seeded > /archive/READY && sleep 3600"]
      resources:
        requests:
          cpu: "25m"
          memory: "32Mi"
        limits:
          cpu: "50m"
          memory: "64Mi"
      volumeMounts:
        - name: archive
          mountPath: /archive
  volumes:
    - name: archive
      persistentVolumeClaim:
        claimName: order-archive-pvc
EOF

echo "waiting for order-archive-pvc to Bound (WaitForFirstConsumer + seed Pod)..."
kubectl -n "$LEARNER_NS" wait --for=jsonpath='{.status.phase}'=Bound pvc/order-archive-pvc --timeout=180s \
  || echo "WARN: order-archive-pvc not Bound yet" >&2
kubectl -n "$LEARNER_NS" wait --for=condition=Ready pod/archive-seed --timeout=180s \
  || echo "WARN: archive-seed not Ready yet" >&2

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
echo "setup ok: ${CHALLENGE_ID:-lab} in ${LEARNER_NS} (VolumeSnapshot is created by the learner)"
