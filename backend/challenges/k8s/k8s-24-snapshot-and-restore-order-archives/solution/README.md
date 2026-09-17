# Solution — Snapshot and Restore Order Archives

Take VolumeSnapshot `order-archive-snap` of `order-archive-pvc`, then restore into a new PVC `order-archive-pvc-restore` (optional check Pod mounts it at `/restore`).

Docs: [Volume Snapshots](https://kubernetes.io/docs/concepts/storage/volume-snapshots/)

## Solution YAML

Save as `order-archive-snapshot-l24.yaml`:

```yaml
apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshot
metadata:
  name: order-archive-snap
spec:
  volumeSnapshotClassName: quickbyte-snapclass
  source:
    persistentVolumeClaimName: order-archive-pvc
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: order-archive-pvc-restore
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi
  dataSource:
    name: order-archive-snap
    kind: VolumeSnapshot
    apiGroup: snapshot.storage.k8s.io
---
apiVersion: v1
kind: Pod
metadata:
  name: archive-restore-check
spec:
  containers:
    - name: check
      image: busybox:1.36
      command: ["sleep", "3600"]
      volumeMounts:
        - name: restore
          mountPath: /restore
  volumes:
    - name: restore
      persistentVolumeClaim:
        claimName: order-archive-pvc-restore
```

## Declarative

```bash
kubectl apply -f order-archive-snapshot-l24.yaml
kubectl get volumesnapshot order-archive-snap
kubectl get pvc order-archive-pvc-restore
```

Wait until the snapshot is ready and the restored PVC is **Bound** (when the snapshot CSI is available), then **Submit**. Do not delete the original archive claim.
