#!/usr/bin/env bash
# Grade k8s-42-ship-notification-templates-as-files — ConfigMap volume mount.
set -euo pipefail

: "${LEARNER_NS:?LEARNER_NS required}"
: "${CHALLENGE_ID:?CHALLENGE_ID required}"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

pass() {
  echo "PASS: $*"
  exit 0
}

CM="notification-templates"
DEPLOY="notification-service"
WANT_REPLICAS="2"
WANT_VOL="templates"
WANT_MOUNT="/etc/notification/templates"
KEY1="order-confirm.txt"
KEY2="payment-ok.txt"
VAL1="Your QuickByte order is confirmed."
VAL2="Payment received. Thank you."

if ! kubectl -n "$LEARNER_NS" get configmap "$CM" >/dev/null 2>&1; then
  fail "configmap/${CM} not found"
fi

D1="$(kubectl -n "$LEARNER_NS" get configmap "$CM" -o jsonpath="{.data['${KEY1}']}" 2>/dev/null || true)"
D2="$(kubectl -n "$LEARNER_NS" get configmap "$CM" -o jsonpath="{.data['${KEY2}']}" 2>/dev/null || true)"
# Accept optional trailing newline from `|` block scalars
D1="${D1%"${D1##*[![:space:]]}"}"
D2="${D2%"${D2##*[![:space:]]}"}"
[[ "$D1" == "$VAL1" ]] || fail "ConfigMap key ${KEY1} must be '${VAL1}' (got '${D1}')"
[[ "$D2" == "$VAL2" ]] || fail "ConfigMap key ${KEY2} must be '${VAL2}' (got '${D2}')"

if ! kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" >/dev/null 2>&1; then
  fail "deployment/${DEPLOY} not found"
fi

READY="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || true)"
DESIRED="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.spec.replicas}' 2>/dev/null || true)"
[[ "$DESIRED" == "$WANT_REPLICAS" ]] || fail "replicas must be ${WANT_REPLICAS} (got '${DESIRED}')"
[[ "${READY:-0}" == "$WANT_REPLICAS" ]] || fail "readyReplicas must be ${WANT_REPLICAS} (got '${READY:-0}')"

# Volume named templates from configMap notification-templates
VOL_NAME="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath="{.spec.template.spec.volumes[?(@.configMap.name=='${CM}')].name}" 2>/dev/null || true)"
[[ "$VOL_NAME" == "$WANT_VOL" ]] || fail "volume from configMap/${CM} must be named ${WANT_VOL} (got '${VOL_NAME}')"

MOUNT_PATH="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath="{.spec.template.spec.containers[0].volumeMounts[?(@.name=='${WANT_VOL}')].mountPath}" 2>/dev/null || true)"
[[ "$MOUNT_PATH" == "$WANT_MOUNT" ]] || fail "volumeMount path must be ${WANT_MOUNT} (got '${MOUNT_PATH}')"

pass "configmap/${CM} mounted as files at ${WANT_MOUNT} on deploy/${DEPLOY} (${WANT_REPLICAS}/${WANT_REPLICAS} Ready)"
