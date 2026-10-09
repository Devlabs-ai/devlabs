#!/usr/bin/env bash
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
      tier: app
  template:
    metadata:
      labels:
        app: order-processor
        tier: app
    spec:
      containers:
        - name: order-processor
          image: devsetu/order-processor:v1.2
          ports:
            - containerPort: 8000
EOF
echo "setup ok: order-processor-deploy seeded in ${LEARNER_NS}"
