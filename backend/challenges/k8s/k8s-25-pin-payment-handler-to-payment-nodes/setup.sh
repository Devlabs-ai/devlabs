#!/usr/bin/env bash
set -euo pipefail
: "${LEARNER_NS:?}"
NODE="$(kubectl get nodes -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
if [[ -n "$NODE" ]]; then
  kubectl label node "$NODE" workload=payments --overwrite >/dev/null 2>&1 || true
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
echo "setup ok: ${CHALLENGE_ID:-lab} in ${LEARNER_NS}"
