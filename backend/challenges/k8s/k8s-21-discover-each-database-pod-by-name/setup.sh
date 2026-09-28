#!/usr/bin/env bash
# Baseline StatefulSet so the headless Service has backends.
# Mirror L20: gp2 + PGDATA + fsGroup so pods can actually become Ready.
# Always recreate STS+PVCs — volumeClaimTemplates are immutable, and a parked
# snapshot may still carry an older claim without storageClassName.
set -euo pipefail
: "${LEARNER_NS:?}"

kubectl -n "$LEARNER_NS" delete statefulset orders-db --ignore-not-found --wait=true
kubectl -n "$LEARNER_NS" delete pvc -l app=orders-db --ignore-not-found --wait=true

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
          resources:
            requests:
              cpu: "100m"
              memory: "512Mi"
            limits:
              cpu: "200m"
              memory: "512Mi"
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
EOF
echo "setup ok: ${CHALLENGE_ID:-lab} in ${LEARNER_NS}"
