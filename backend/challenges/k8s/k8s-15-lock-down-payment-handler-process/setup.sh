#!/usr/bin/env bash
set -euo pipefail
: "${LEARNER_NS:?LEARNER_NS required}"
: "${CHALLENGE_ID:?CHALLENGE_ID required}"
kubectl -n "$LEARNER_NS" apply -f - <<'EOF'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-handler
spec:
  replicas: 2
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
          image: devsetu/payment-handler:v1.0
          ports:
            - containerPort: 8000
          resources:
            requests:
              cpu: "20m"
              memory: "32Mi"
            limits:
              cpu: "40m"
              memory: "64Mi"
EOF
echo "setup ok: payment-handler seeded in ${LEARNER_NS}"
