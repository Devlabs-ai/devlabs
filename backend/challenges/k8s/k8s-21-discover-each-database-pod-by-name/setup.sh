#!/usr/bin/env bash
# Baseline StatefulSet so headless Service has backends.
set -euo pipefail
: "${LEARNER_NS:?}"

kubectl -n "$LEARNER_NS" apply -f - <<EOF
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
EOF
echo "setup ok: ${CHALLENGE_ID:-lab} in ${LEARNER_NS}"
