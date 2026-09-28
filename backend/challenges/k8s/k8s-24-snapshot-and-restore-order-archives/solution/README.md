# Solution — Snapshot and Restore Order Archives

Take VolumeSnapshot `order-archive-snap` of `order-archive-pvc`, then restore into a new PVC `order-archive-pvc-restore` on **`gp2`**.

Docs: [DevSetu Blog — Volumes, PVs, PVCs, and StorageClasses](/play/devops-engineer/kubernetes/read/volumes-pvs-pvcs-storageclasses) · [Volume Snapshots](https://kubernetes.io/docs/concepts/storage/volume-snapshots/)

## Solution YAML (required)

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
      storage: 500Mi
  storageClassName: gp2
  dataSource:
    name: order-archive-snap
    kind: VolumeSnapshot
    apiGroup: snapshot.storage.k8s.io
```

## Optional check Pod (not graded)

```yaml
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

Confirm the snapshot and restore PVC objects match the SPEC, then **Submit**. Do not delete the original archive claim. The check Pod and Bound/readyToUse status are optional.
