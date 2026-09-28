#!/usr/bin/env bash
# Platform: publish a per-namespace StorageClass. Learners list cluster SCs,
# pick the one whose name ends with $LEARNER_NS, read annotated size/mount hints,
# then create PVC + consumer Pod only.
set -euo pipefail
: "${LEARNER_NS:?}"

SC_NAME="quickbyte-fast-${LEARNER_NS}"
SIZE_HINT="1Gi"
MOUNT_PATH="/var/cache/orders"

kubectl apply -f - <<EOF
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: ${SC_NAME}
  labels:
    app.kubernetes.io/part-of: devlabs
    devlabs.ai/lab: dynamic-disks
    devlabs.ai/learner-ns: ${LEARNER_NS}
    quickbyte.ai/for: order-cache
  annotations:
    quickbyte.ai/size-hint: "${SIZE_HINT}"
    quickbyte.ai/mount-path: "${MOUNT_PATH}"
provisioner: ebs.csi.aws.com
volumeBindingMode: WaitForFirstConsumer
reclaimPolicy: Delete
parameters:
  type: gp3
EOF

echo "setup ok: ${CHALLENGE_ID:-lab} in ${LEARNER_NS} (StorageClass ${SC_NAME}; size-hint=${SIZE_HINT}; mount-path=${MOUNT_PATH})"
