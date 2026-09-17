#!/usr/bin/env bash
set -euo pipefail
: "${LEARNER_NS:?}"
NODE="$(kubectl get nodes -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
if [[ -n "$NODE" ]]; then
  kubectl label node "$NODE" workload=notifications --overwrite >/dev/null 2>&1 || true
fi
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
      containers:
        - name: notification-service
          image: rithvikreddyalkanti/notification-service:v1.0
          ports:
            - containerPort: 8080
EOF
echo "setup ok: ${CHALLENGE_ID:-lab} in ${LEARNER_NS}"
