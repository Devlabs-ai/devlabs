# Solution — Local Disk for Hot Payment Writes

Pin the platform **local** PersistentVolume with `volumeName` on a PVC, then mount it into Payment Handler at `/var/log/payments`. Do **not** create or edit a PersistentVolume.

Docs: [DevSetu Blog — Volumes, PVs, PVCs, and StorageClasses](/play/devops-engineer/kubernetes/read/volumes-pvs-pvcs-storageclasses) · [Local Volumes](https://kubernetes.io/docs/concepts/storage/volumes/#local) · [PersistentVolumeClaims](https://kubernetes.io/docs/concepts/storage/persistent-volumes/#persistentvolumeclaims)

## Discover the platform PV

```bash
kubectl get pv
# pick the one whose name ends with your lab namespace ($LEARNER_NS)
```

## Solution YAML

Save as `payment-local-storage-l23.yaml` (set `volumeName` to that PV):

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: payment-local-pvc
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 500Mi
  storageClassName: local-storage
  volumeName: <platform-pv-ending-with-your-namespace>
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-handler
spec:
  replicas: 1
  selector:
    matchLabels:
      app: payment-handler
  template:
    metadata:
      labels:
        app: payment-handler
    spec:
      containers:
        - name: payment-handler
          image: devsetu/payment-handler:v1.0
          ports:
            - containerPort: 8000
          volumeMounts:
            - name: payment-logs
              mountPath: /var/log/payments
      volumes:
        - name: payment-logs
          persistentVolumeClaim:
            claimName: payment-local-pvc
```

## Declarative

```bash
kubectl apply -f payment-local-storage-l23.yaml
kubectl get pvc payment-local-pvc
kubectl get deploy payment-handler
kubectl get pods -l app=payment-handler -o wide
```

Wait until the PVC is **Bound** to that PV and the Pod is **Ready** (local volumes force the Pod onto the labeled node), then **Submit**.

Do **not** create or edit a PersistentVolume — select the platform one with `volumeName`, then mount the PVC. Keep **1** replica. Work only in your lab namespace (not `default`).
