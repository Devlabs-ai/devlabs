# Solution — Provision Order Archive Disk

Register 1Gi of archive disk as a cluster-scoped PersistentVolume. Do not mount it into a Pod yet.

Docs: [PersistentVolumes](https://kubernetes.io/docs/concepts/storage/persistent-volumes/)

## Solution YAML

Save as `order-archive-pv-l18.yaml`:

```yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: order-archive-pv
spec:
  capacity:
    storage: 1Gi
  accessModes:
    - ReadWriteOnce
  persistentVolumeReclaimPolicy: Retain
  storageClassName: manual
  volumeMode: Filesystem
  hostPath:
    path: /mnt/data/order-archive
```

## Declarative

```bash
kubectl apply -f order-archive-pv-l18.yaml
kubectl get pv order-archive-pv
```

Wait until the PV is **Available**, then **Submit**.
