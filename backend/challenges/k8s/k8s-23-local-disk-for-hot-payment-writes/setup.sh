#!/usr/bin/env bash
# Platform: ensure local SSD path exists on the labeled node, register a
# cluster-scoped local PV for this lab namespace, plus a baseline
# payment-handler Deployment (no volume yet). Node label
# quickbyte.ai/local-ssd comes from the platform node pool — setup must not
# label or taint nodes. Learners pin the PV via PVC volumeName, then mount.
set -euo pipefail
: "${LEARNER_NS:?}"

# Unique PV + host path per lab namespace (shared node pools / multi-tenant).
PV_NAME="payment-local-pv-${LEARNER_NS}"
LOCAL_PATH="/mnt/local-ssd/payments-${LEARNER_NS}"
# Pod name must be a valid DNS label (<=63 chars).
MK_POD="dl-mk-$(echo "${LEARNER_NS}" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g' | cut -c1-50)"

# Local PVs do not create the directory — mkdir on the host via a privileged
# one-shot Pod scheduled onto the local-ssd pool.
kubectl -n kube-system delete pod "${MK_POD}" --ignore-not-found --wait=false >/dev/null 2>&1 || true
kubectl -n kube-system apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: ${MK_POD}
  labels:
    app.kubernetes.io/part-of: devlabs
    app.kubernetes.io/component: ensure-local-path
    devlabs.ai/learner-ns: ${LEARNER_NS}
spec:
  restartPolicy: Never
  nodeSelector:
    quickbyte.ai/local-ssd: "true"
  containers:
    - name: mkdir
      image: public.ecr.aws/docker/library/busybox:1.36
      command: ["sh", "-c", "mkdir -p /host${LOCAL_PATH} && chmod 777 /host${LOCAL_PATH}"]
      securityContext:
        privileged: true
      volumeMounts:
        - name: host-root
          mountPath: /host
  volumes:
    - name: host-root
      hostPath:
        path: /
        type: Directory
EOF

echo "waiting for host path ${LOCAL_PATH} on local-ssd node..."
if ! kubectl -n kube-system wait --for=jsonpath='{.status.phase}'=Succeeded "pod/${MK_POD}" --timeout=90s; then
  kubectl -n kube-system describe "pod/${MK_POD}" >&2 || true
  kubectl -n kube-system logs "pod/${MK_POD}" >&2 || true
  exit 1
fi
kubectl -n kube-system delete pod "${MK_POD}" --ignore-not-found --wait=false >/dev/null 2>&1 || true

kubectl apply -f - <<EOF
apiVersion: v1
kind: PersistentVolume
metadata:
  name: ${PV_NAME}
  labels:
    app.kubernetes.io/part-of: devlabs
    devlabs.ai/lab: local-disk
    devlabs.ai/learner-ns: ${LEARNER_NS}
spec:
  capacity:
    storage: 500Mi
  accessModes:
    - ReadWriteOnce
  persistentVolumeReclaimPolicy: Retain
  storageClassName: local-storage
  volumeMode: Filesystem
  local:
    path: ${LOCAL_PATH}
  nodeAffinity:
    required:
      nodeSelectorTerms:
        - matchExpressions:
            - key: quickbyte.ai/local-ssd
              operator: In
              values:
                - "true"
EOF

kubectl -n "$LEARNER_NS" apply -f - <<EOF
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
          image: devsetu/payment-handler:v1.0
          ports:
            - containerPort: 8000
EOF
echo "setup ok: ${CHALLENGE_ID:-lab} in ${LEARNER_NS} (platform PV ${PV_NAME} path ${LOCAL_PATH})"
