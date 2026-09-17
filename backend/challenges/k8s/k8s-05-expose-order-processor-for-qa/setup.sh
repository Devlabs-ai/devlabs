#!/usr/bin/env bash
# Seed Order Processor Deployment (v1.1) so NodePort Endpoints can become Ready.
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
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
EOF

echo "setup ok: order-processor-deploy seeded in ${LEARNER_NS}"
