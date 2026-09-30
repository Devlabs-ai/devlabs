#!/usr/bin/env bash
# Baseline notification-service + order-processor for podAffinity. Node labels
# come from the platform node pool — setup must not label or taint nodes.
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
      containers:
        - name: notification-service
          image: devsetu/notification-service:v1.0
          ports:
            - containerPort: 8080
EOF
# Order processor pods for podAffinity target (ch27)
kubectl -n "$LEARNER_NS" apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-processor-deploy
spec:
  replicas: 1
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
          image: devsetu/order-processor:v1.1
          ports:
            - containerPort: 8000
EOF
echo "setup ok: ${CHALLENGE_ID:-lab} in ${LEARNER_NS}"
