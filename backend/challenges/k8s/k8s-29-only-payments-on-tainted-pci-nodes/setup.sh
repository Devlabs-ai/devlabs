#!/usr/bin/env bash
set -euo pipefail
: "${LEARNER_NS:?}"
NODE_COUNT="$(kubectl get nodes --no-headers 2>/dev/null | wc -l | tr -d " ")"
NODE="$(kubectl get nodes -o jsonpath="{.items[0].metadata.name}" 2>/dev/null || true)"
if [[ -n "$NODE" ]]; then
  kubectl label node "$NODE" pci=true --overwrite >/dev/null 2>&1 || true
  # Only taint when multiple nodes exist so other workloads can still schedule.
  if [[ "${NODE_COUNT}" -gt 1 ]]; then
    kubectl taint node "$NODE" pci=true:NoSchedule --overwrite >/dev/null 2>&1 || true
  fi
fi
kubectl -n "$LEARNER_NS" apply -f - <<EOF
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
          image: rithvikreddyalkanti/payment-handler:v1.0
          ports:
            - containerPort: 8000
EOF
kubectl -n "$LEARNER_NS" apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: notification-service
spec:
  replicas: 1
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
