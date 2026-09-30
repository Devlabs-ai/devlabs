# Solution — Claim Disk for Order Processor

Create PVC `order-archive-pvc` that **pins** the platform PersistentVolume with `volumeName`, then mount it into Deployment `order-processor-deploy` at `/data/archive`.

Docs: [DevSetu Blog — Volumes, PVs, PVCs, and StorageClasses](/play/devops-engineer/kubernetes/read/volumes-pvs-pvcs-storageclasses) · [PersistentVolumeClaims](https://kubernetes.io/docs/concepts/storage/persistent-volumes/#persistentvolumeclaims)

## Discover the platform PV

The platform registered a cluster-scoped PV for your lab. PVs are not namespaced, so you will see other labs' PVs too; yours is the one whose name **ends with your namespace**:

```bash
echo "$LEARNER_NS"   # your lab namespace
kubectl get pv       # pick the PV whose name ends with it (STATUS Available)
```

## Solution YAML

Save as `order-archive-pvc-l19.yaml` (set `volumeName` to the PV you found):

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: order-archive-pvc
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 100Mi
  storageClassName: manual
  volumeName: <your-platform-pv-name>
```

Save as `order-processor-pvc-l19.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-processor-deploy
spec:
  replicas: 1
  selector:
    matchLabels:
      app: order-processor
      version: v1.1
  template:
    metadata:
      labels:
        app: order-processor
        version: v1.1
    spec:
      containers:
        - name: order-processor
          image: devsetu/order-processor:v1.1
          ports:
            - containerPort: 8000
          volumeMounts:
            - name: archive
              mountPath: /data/archive
      volumes:
        - name: archive
          persistentVolumeClaim:
            claimName: order-archive-pvc
```

## Declarative

```bash
kubectl apply -f order-archive-pvc-l19.yaml
kubectl apply -f order-processor-pvc-l19.yaml
kubectl get pvc order-archive-pvc
kubectl get pv   # your PV should now show STATUS Bound, CLAIM <namespace>/order-archive-pvc
kubectl get deploy order-processor-deploy
kubectl get pods -l app=order-processor -o wide
```

Wait until the PVC is **Bound** to that PV and the Deployment is **1/1 Ready**, then **Submit**.

Do **not** create or edit a PersistentVolume — select the platform one with `volumeName`, then mount the PVC. Work only in your lab namespace (not `default`).
