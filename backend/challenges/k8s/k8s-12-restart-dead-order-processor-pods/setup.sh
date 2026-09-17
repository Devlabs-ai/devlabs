#!/usr/bin/env bash
# Seed Order Processor zombie: Running, but GET /health hangs until liveness restart.
set -euo pipefail
: "${LEARNER_NS:?LEARNER_NS required}"
: "${CHALLENGE_ID:?CHALLENGE_ID required}"
kubectl -n "$LEARNER_NS" apply -f - <<'EOF'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-processor-deploy
spec:
  replicas: 2
  selector:
    matchLabels:
      app: order-processor
  template:
    metadata:
      labels:
        app: order-processor
    spec:
      volumes:
        - name: zombie-mark
          emptyDir: {}
      containers:
        - name: order-processor
          image: rithvikreddyalkanti/zombie-order-processor:1.0
          ports:
            - containerPort: 8000
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
          volumeMounts:
            - name: zombie-mark
              mountPath: /var/run/zombie
EOF
echo "setup ok: order-processor-deploy 1.0 seeded in ${LEARNER_NS}"
