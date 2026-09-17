#!/usr/bin/env bash
set -euo pipefail
: "${LEARNER_NS:?}"
kubectl -n "$LEARNER_NS" apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: notification-service
spec:
  replicas: 4
  selector:
    matchLabels:
      app: notification-service
      track: stable
  template:
    metadata:
      labels:
        app: notification-service
        track: stable
    spec:
      containers:
        - name: notification-service
          image: rithvikreddyalkanti/notification-service:v1.0
          ports:
            - containerPort: 8080
---
apiVersion: v1
kind: Service
metadata:
  name: notification-service
spec:
  selector:
    app: notification-service
  ports:
    - name: http
      port: 8080
      targetPort: 8080
EOF
echo "setup ok: ${CHALLENGE_ID:-lab} in ${LEARNER_NS}"
