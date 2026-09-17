# Solution — Claim Disk for Order Processor

Create PVC `order-archive-pvc` matching the platform PV, then mount it into Deployment `order-processor-deploy` at `/data/archive`.

Docs: [PersistentVolumeClaims](https://kubernetes.io/docs/concepts/storage/persistent-volumes/#persistentvolumeclaims)

## Solution YAML

Save as `order-archive-pvc-l19.yaml`:

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
      storage: 1Gi
  storageClassName: manual
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
          image: rithvikreddyalkanti/order-processor:v1.1
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
kubectl get deploy order-processor-deploy
kubectl get pods -l app=order-processor -o wide
```

Wait until the PVC is **Bound** and the Deployment is **1/1 Ready**, then **Submit**.

Do **not** create or edit a PersistentVolume — request and mount what the platform already offered. Work only in your lab namespace (not `default`).
