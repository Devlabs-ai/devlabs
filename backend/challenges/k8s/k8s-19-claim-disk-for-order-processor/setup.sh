#!/usr/bin/env bash
# Platform: register a cluster-scoped PV for this lab namespace, plus a baseline
# Order Processor Deployment (no volume yet). Learners only create PVC + mount.
set -euo pipefail
: "${LEARNER_NS:?}"

# Unique PV per lab namespace so shared clusters do not collide on one Bound volume.
PV_NAME="order-archive-pv-${LEARNER_NS}"

kubectl apply -f - <<EOF
apiVersion: v1
kind: PersistentVolume
metadata:
  name: ${PV_NAME}
  labels:
    app.kubernetes.io/part-of: devlabs
    devlabs.ai/lab: claim-disk
    devlabs.ai/learner-ns: ${LEARNER_NS}
spec:
  capacity:
    storage: 1Gi
  accessModes:
    - ReadWriteOnce
  persistentVolumeReclaimPolicy: Retain
  storageClassName: manual
  volumeMode: Filesystem
  hostPath:
    path: /mnt/data/order-archive-${LEARNER_NS}
EOF

kubectl -n "$LEARNER_NS" apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-processor-deploy
spec:
  replicas: 2
  selector:
    matchLabels:
      app: order-processor
      version: v1.1
  template:
    metadata:
      labels:
        app: order-processor
        version: v1.1
    spec:
      containers:
        - name: order-processor
          image: rithvikreddyalkanti/order-processor:v1.1
          ports:
            - containerPort: 8000
EOF
echo "setup ok: ${CHALLENGE_ID:-lab} in ${LEARNER_NS} (platform PV ${PV_NAME})"
