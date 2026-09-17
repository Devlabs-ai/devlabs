#!/usr/bin/env bash
# Pre-create settlement RBAC identity + a payment-handler pod label target.
set -euo pipefail
: "${LEARNER_NS:?}"

kubectl -n "$LEARNER_NS" apply -f - <<EOF
apiVersion: v1
kind: ServiceAccount
metadata:
  name: settlement-exporter
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: settlement-exporter-pod-reader
rules:
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: settlement-exporter-pod-reader
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: settlement-exporter-pod-reader
subjects:
  - kind: ServiceAccount
    name: settlement-exporter
    namespace: ${LEARNER_NS}
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-handler
spec:
  replicas: 1
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
