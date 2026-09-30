#!/usr/bin/env bash
# Baseline payment-handler + notification-service. PCI node label/taint come
# from the platform node pool — setup must not label or taint nodes.
set -euo pipefail
: "${LEARNER_NS:?}"

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
          image: devsetu/payment-handler:v1.0
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
          image: devsetu/notification-service:v1.0
          ports:
            - containerPort: 8080
EOF
echo "setup ok: ${CHALLENGE_ID:-lab} in ${LEARNER_NS}"
