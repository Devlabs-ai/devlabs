# Solution — Dynamic Disks via StorageClass

A StorageClass is already in the cluster for this lab. Find it by **namespace suffix**,
read its annotated size/mount hints, then create a PVC + consumer Pod. Do not create
or edit the StorageClass.

Docs: [DevSetu Blog — Volumes, PVs, PVCs, and StorageClasses](/play/devops-engineer/kubernetes/read/volumes-pvs-pvcs-storageclasses) · [StorageClasses](https://kubernetes.io/docs/concepts/storage/storage-classes/)

## 1. Find the StorageClass for this lab

```bash
kubectl get sc
# name ends with $LEARNER_NS (e.g. …-ns-admin)
SC="$(kubectl get sc -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' \
  | grep -E -- "-${LEARNER_NS}$" | head -1)"
echo "SC=$SC"
kubectl describe sc "$SC"
```

## 2. Read size and mount path from annotations

```bash
SIZE="$(kubectl get sc "$SC" -o jsonpath='{.metadata.annotations.quickbyte\.ai/size-hint}')"
MOUNT="$(kubectl get sc "$SC" -o jsonpath='{.metadata.annotations.quickbyte\.ai/mount-path}')"
echo "storageClassName=$SC size=$SIZE mountPath=$MOUNT"
```

## 3. Solution YAML

Save as `order-cache-pvc-l22.yaml` (substitute the values you found):

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
      storage: <size-hint from SC>
  storageClassName: <discovered SC name>
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
          mountPath: <mount-path from SC>
  volumes:
    - name: cache
      persistentVolumeClaim:
        claimName: order-cache-pvc
```

## Declarative

```bash
kubectl apply -f order-cache-pvc-l22.yaml
kubectl get pvc order-cache-pvc
kubectl get pod cache-writer
```

Wait for the PVC to become **Bound** when CSI can provision (Pod must schedule first because of `WaitForFirstConsumer`), then **Submit**.
