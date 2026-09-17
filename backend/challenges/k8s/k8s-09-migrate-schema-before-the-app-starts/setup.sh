#!/usr/bin/env bash
# Seed minimal Postgres + baseline Order Processor (no init yet).
set -euo pipefail
: "${LEARNER_NS:?LEARNER_NS required}"
: "${CHALLENGE_ID:?CHALLENGE_ID required}"

kubectl -n "$LEARNER_NS" apply -f - <<'EOF'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orders-db
spec:
  replicas: 1
  selector:
    matchLabels:
      app: orders-db
  template:
    metadata:
      labels:
        app: orders-db
    spec:
      containers:
        - name: postgres
          image: postgres:16-alpine
          ports:
            - containerPort: 5432
          env:
            - name: POSTGRES_USER
              value: postgres
            - name: POSTGRES_PASSWORD
              value: quickbyte
            - name: POSTGRES_DB
              value: orders
          resources:
            requests:
              cpu: "50m"
              memory: "64Mi"
---
apiVersion: v1
kind: Service
metadata:
  name: orders-db
spec:
  type: ClusterIP
  selector:
    app: orders-db
  ports:
    - name: postgres
      port: 5432
      targetPort: 5432
---
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
      containers:
        - name: order-processor
          image: rithvikreddyalkanti/order-processor:v1.2
          ports:
            - containerPort: 8000
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
EOF

# Wait for Postgres so learner inits can connect (image pull may take a bit).
kubectl -n "$LEARNER_NS" rollout status deploy/orders-db --timeout=180s

echo "setup ok: orders-db + order-processor-deploy seeded in ${LEARNER_NS}"
