#!/usr/bin/env bash
# Baseline payment-handler Deployment. Node labels (workload=payments) come from
# the platform node pool — setup must not label or taint nodes.
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
echo "setup ok: ${CHALLENGE_ID:-lab} in ${LEARNER_NS}"
