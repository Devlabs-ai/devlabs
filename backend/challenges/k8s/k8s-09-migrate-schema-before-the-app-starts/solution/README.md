# Solution — Migrate Schema Before the App Starts

Stay in your lab namespace. Postgres is already running as Deployment/Service **`orders-db`** (database `orders`, user `postgres`, password `quickbyte`). Update Deployment `order-processor-deploy` with Init Container **`schema-migrate`** that waits for Postgres, applies idempotent DDL, then exits `0` so Order Processor can start.

Docs: [Init Containers](https://kubernetes.io/docs/concepts/workloads/pods/init-containers/)

## Solution YAML

Save as `order-processor-init-l9.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-processor-deploy
spec:
  replicas: 2
  selector:
    matchLabels:
      app: order-processor
      tier: app
  template:
    metadata:
      labels:
        app: order-processor
        tier: app
    spec:
      initContainers:
        - name: schema-migrate
          image: postgres:16-alpine
          env:
            - name: PGPASSWORD
              value: quickbyte
          command:
            - /bin/sh
            - -c
            - |
              set -e
              until pg_isready -h orders-db -U postgres -d orders; do
                echo "waiting for orders-db…"
                sleep 2
              done
              psql -h orders-db -U postgres -d orders -v ON_ERROR_STOP=1 -c \
                "CREATE TABLE IF NOT EXISTS orders (
                   order_id TEXT PRIMARY KEY,
                   customer_id TEXT,
                   total NUMERIC,
                   status TEXT
                 );"
              psql -h orders-db -U postgres -d orders -v ON_ERROR_STOP=1 -c \
                "CREATE TABLE IF NOT EXISTS order_items (
                   id SERIAL PRIMARY KEY,
                   order_id TEXT,
                   item TEXT
                 );"
              echo "Migrations OK"
          resources:
            requests:
              cpu: "50m"
              memory: "64Mi"
      containers:
        - name: order-processor
          image: rithvikreddyalkanti/order-processor:v1.2
          ports:
            - containerPort: 8000
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
```

## Declarative

```bash
kubectl get deploy,svc orders-db
kubectl apply -f order-processor-init-l9.yaml
kubectl rollout status deploy/order-processor-deploy
kubectl get pods -l app=order-processor,tier=app
kubectl logs deploy/order-processor-deploy -c schema-migrate
```

Confirm tables (optional):

```bash
kubectl exec deploy/orders-db -- env PGPASSWORD=quickbyte \
  psql -U postgres -d orders -c '\dt'
```

Wait until **2** Pods are `Running` / `READY` **1/1**, then **Submit**.

Use `CREATE TABLE IF NOT EXISTS` so both replicas’ inits can run safely. Migrations must be `spec.initContainers`, not a sidecar or Job.
