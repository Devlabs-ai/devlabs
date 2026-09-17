# Solution — Local Disk for Hot Payment Writes

Create a `local` PersistentVolume with node affinity, claim it, and mount it into Payment Handler at `/var/log/payments`.

Docs: [Local Volumes](https://kubernetes.io/docs/concepts/storage/volumes/#local)

## Solution YAML

Save as `payment-local-storage-l23.yaml`:

```yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: payment-local-pv
spec:
  capacity:
    storage: 5Gi
  accessModes:
    - ReadWriteOnce
  storageClassName: local-storage
  local:
    path: /mnt/local-ssd/payments
  nodeAffinity:
    required:
      nodeSelectorTerms:
        - matchExpressions:
            - key: quickbyte.ai/local-ssd
              operator: In
              values:
                - "true"
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: payment-local-pvc
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 5Gi
  storageClassName: local-storage
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
          image: rithvikreddyalkanti/payment-handler:v1.0
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
kubectl get pv payment-local-pv
kubectl get pvc payment-local-pvc
kubectl get deploy payment-handler
kubectl get pods -l app=payment-handler -o wide
```

Wait until the PVC is **Bound** and the Pod is **Ready** on the labeled node, then **Submit**. Use `local` (not `hostPath`).
