#!/usr/bin/env bash
# l1-clusterip-service — ensure Deployment front-desk is ready; learner adds the Service.
set -euo pipefail

: "${LEARNER_NS:?LEARNER_NS required}"
: "${CHALLENGE_ID:?CHALLENGE_ID required}"

kubectl -n "$LEARNER_NS" delete pod front-desk --ignore-not-found --wait=false >/dev/null 2>&1 || true
kubectl -n "$LEARNER_NS" delete svc front-desk --ignore-not-found --wait=false >/dev/null 2>&1 || true

kubectl -n "$LEARNER_NS" apply -f - <<'EOF'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: front-desk
  labels:
    app: guestbook
    tier: frontend
spec:
  replicas: 3
  selector:
    matchLabels:
      app: guestbook
      tier: frontend
  template:
    metadata:
      labels:
        app: guestbook
        tier: frontend
    spec:
      containers:
        - name: front-desk
          image: nginx:1.25
          ports:
            - containerPort: 80
EOF

kubectl -n "$LEARNER_NS" rollout status deployment/front-desk --timeout=120s
echo "setup ok: deployment/front-desk ready in ${LEARNER_NS} — create the ClusterIP Service"
