#!/usr/bin/env bash
# Seed slow-warming Order Processor: /health is 503 for ~25s.
# Liveness 3/3/3 (~9s kill) with no startup probe → CrashLoopBackOff mid-warmup.
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
      containers:
        - name: order-processor
          image: rithvikreddyalkanti/slow-order-processor:1.0
          imagePullPolicy: Always
          ports:
            - containerPort: 8000
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
          # Aggressive on purpose: kills ~9s into the ~25s /health warmup.
          livenessProbe:
            httpGet:
              path: /health
              port: 8000
            initialDelaySeconds: 3
            periodSeconds: 3
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /health
              port: 8000
            initialDelaySeconds: 3
            periodSeconds: 3
            failureThreshold: 3
EOF
echo "setup ok: order-processor-deploy (slow-order-processor:1.0, live/ready, no startup) in ${LEARNER_NS}"
