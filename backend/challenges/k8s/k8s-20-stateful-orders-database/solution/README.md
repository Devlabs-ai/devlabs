# Solution — Stateful Orders Database

Create StatefulSet `orders-db` with 2 Postgres replicas, stable identity via `serviceName: orders-db`, and per-replica disks from `volumeClaimTemplates`.

Docs: [DevSetu Blog — StatefulSets](/play/devops-engineer/kubernetes/read/statefulsets) · [StatefulSets](https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/)

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
      securityContext:
        fsGroup: 70
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
            - name: PGDATA
              value: /var/lib/postgresql/data/pgdata
          args: ["-c", "shared_buffers=16MB"]
          resources:
            requests:
              cpu: "20m"
              memory: "64Mi"
            limits:
              cpu: "100m"
              memory: "128Mi"
          volumeMounts:
            - name: data
              mountPath: /var/lib/postgresql/data
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        storageClassName: gp2
        resources:
          requests:
            storage: 500Mi
```

## Why `PGDATA` and `fsGroup`

- Mount the PVC at `/var/lib/postgresql/data`, but set **`PGDATA`** to a subdirectory so Postgres does not treat the volume root (e.g. `lost+found`) as the data dir.
- **`fsGroup: 70`** lets the alpine `postgres` user write the volume.

## Declarative

```bash
# If a previous attempt CrashLoop'd, delete STS + PVCs so disks re-init cleanly:
kubectl delete sts orders-db --ignore-not-found
kubectl delete pvc -l app=orders-db --ignore-not-found

kubectl apply -f orders-db-sts-l20.yaml
kubectl get sts orders-db
kubectl get pods -l app=orders-db -o wide
kubectl get pvc -l app=orders-db
```

Wait until **2/2** replicas are Ready, then **Submit**. Use a StatefulSet (not a Deployment).
