# Solution — Stateful Orders Database

Create StatefulSet `orders-db` with 2 Postgres replicas, stable identity via `serviceName: orders-db`, and per-replica disks from `volumeClaimTemplates`.

Docs: [StatefulSets](https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/)

## Solution YAML

Save as `orders-db-sts-l20.yaml`:

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: orders-db
spec:
  serviceName: orders-db
  replicas: 2
  selector:
    matchLabels:
      app: orders-db
      tier: data
  template:
    metadata:
      labels:
        app: orders-db
        tier: data
    spec:
      containers:
        - name: postgres
          image: postgres:16-alpine
          ports:
            - containerPort: 5432
          env:
            - name: POSTGRES_PASSWORD
              value: quickbyte-lab
            - name: POSTGRES_DB
              value: orders
          resources:
            requests:
              cpu: "100m"
              memory: "256Mi"
          volumeMounts:
            - name: data
              mountPath: /var/lib/postgresql/data
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        resources:
          requests:
            storage: 1Gi
```

## Declarative

```bash
kubectl apply -f orders-db-sts-l20.yaml
kubectl get sts orders-db
kubectl get pods -l app=orders-db -o wide
kubectl get pvc -l app=orders-db
```

Wait until **2/2** replicas are Ready, then **Submit**. Use a StatefulSet (not a Deployment).
