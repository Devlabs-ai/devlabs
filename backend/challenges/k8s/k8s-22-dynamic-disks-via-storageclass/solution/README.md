# Solution — Dynamic Disks via StorageClass

Publish StorageClass `quickbyte-fast`, then request a PVC and attach it to a small consumer Pod so the provisioner can create the disk.

Docs: [StorageClasses](https://kubernetes.io/docs/concepts/storage/storage-classes/)

## Solution YAML

Save as `quickbyte-fast-sc-l22.yaml`:

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: quickbyte-fast
provisioner: ebs.csi.aws.com
volumeBindingMode: WaitForFirstConsumer
reclaimPolicy: Delete
parameters:
  type: gp3
```

Save as `order-cache-pvc-l22.yaml`:

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: order-cache-pvc
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 2Gi
  storageClassName: quickbyte-fast
---
apiVersion: v1
kind: Pod
metadata:
  name: cache-writer
spec:
  containers:
    - name: writer
      image: busybox:1.36
      command: ["sleep", "3600"]
      volumeMounts:
        - name: cache
          mountPath: /cache
  volumes:
    - name: cache
      persistentVolumeClaim:
        claimName: order-cache-pvc
```

## Declarative

```bash
kubectl apply -f quickbyte-fast-sc-l22.yaml
kubectl apply -f order-cache-pvc-l22.yaml
kubectl get sc quickbyte-fast
kubectl get pvc order-cache-pvc
kubectl get pod cache-writer
```

Wait for the PVC to become **Bound** (when the CSI provisioner is available), then **Submit**. Do not hand-create a PersistentVolume.
