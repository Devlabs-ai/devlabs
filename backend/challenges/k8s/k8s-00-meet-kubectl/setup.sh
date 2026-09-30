#!/usr/bin/env bash
# k8s-00-meet-kubectl — seed the Pods the learner explores with kubectl.
set -euo pipefail

: "${LEARNER_NS:?LEARNER_NS required}"
: "${CHALLENGE_ID:?CHALLENGE_ID required}"

k() { kubectl -n "$LEARNER_NS" "$@"; }

# Clean slate: learner-made objects from a previous attempt + the seeded Pods.
k delete pod hello web mystery-pod delete-me --ignore-not-found --grace-period=1 --wait=true --timeout=60s >/dev/null 2>&1 || true

# The secret word and exec code are generated *inside* the container, so the only
# way to find them is `kubectl logs` / `kubectl exec` (not describe or get -o yaml).
# Kept to two seeded Pods: the lab cluster has little Pod headroom.
k apply -f - >/dev/null <<'YAML'
apiVersion: v1
kind: Pod
metadata:
  name: mystery-pod
  labels:
    app: mystery
    lab: meet-kubectl
spec:
  terminationGracePeriodSeconds: 1
  containers:
    - name: web
      image: nginx:1.25
      command: ["/bin/sh", "-c"]
      args:
        - |
          set -- anchor bamboo comet dynamo ember falcon glacier harbor igloo jasmine
          shift $(( $(od -An -N1 -tu1 /dev/urandom) % 10 ))
          echo "mystery-pod starting up..."
          echo "The secret word is: $1"
          tr -dc 'A-Z0-9' </dev/urandom | head -c 6 > /tmp/code.txt
          exec nginx -g 'daemon off;'
      ports:
        - containerPort: 80
---
apiVersion: v1
kind: Pod
metadata:
  name: delete-me
  labels:
    app: leftover
    lab: meet-kubectl
spec:
  terminationGracePeriodSeconds: 1
  containers:
    - name: idle
      image: busybox:1.36
      command: ["sleep", "infinity"]
YAML

k wait --for=condition=Ready pod/mystery-pod pod/delete-me --timeout=120s >/dev/null 2>&1 || true

echo "setup ok: mystery-pod and delete-me seeded in ${LEARNER_NS}"
