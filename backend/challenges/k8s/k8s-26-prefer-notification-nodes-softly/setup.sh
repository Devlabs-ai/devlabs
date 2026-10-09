#!/usr/bin/env bash
# Baseline notification-service with a HARD nodeSelector for workload=notifications.
# Learner replaces that with soft preferred nodeAffinity. Node labels come from the
# platform node pool — setup must not label or taint nodes.
set -euo pipefail
: "${LEARNER_NS:?}"

kubectl -n "$LEARNER_NS" apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: notification-service
spec:
  replicas: 2
  selector:
    matchLabels:
      app: notification-service
  template:
    metadata:
      labels:
        app: notification-service
    spec:
      nodeSelector:
        workload: notifications
      containers:
        - name: notification-service
          image: devsetu/notification-service:v1.0
          ports:
            - containerPort: 8080
EOF
echo "setup ok: ${CHALLENGE_ID:-lab} in ${LEARNER_NS} (baseline nodeSelector workload=notifications)"
