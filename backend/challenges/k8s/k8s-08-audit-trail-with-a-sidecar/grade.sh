#!/usr/bin/env bash
# Grade k8s-08-audit-trail-with-a-sidecar — Order Processor sidecar.
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

DEPLOY="order-processor-deploy"
WANT_REPLICAS="2"
WANT_APP="order-processor"
WANT_TIER="app"
WANT_IMAGE="rithvikreddyalkanti/order-processor:v1.2"
WANT_SIDECAR_IMAGE="busybox:1.36"

if ! kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" >/dev/null 2>&1; then
  fail "deployment/${DEPLOY} not found"
fi

DESIRED="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.spec.replicas}' 2>/dev/null || true)"
READY="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || true)"
[[ "$DESIRED" == "$WANT_REPLICAS" ]] || fail "replicas must be ${WANT_REPLICAS} (got '${DESIRED}')"
[[ "${READY:-0}" == "$WANT_REPLICAS" ]] || fail "readyReplicas must be ${WANT_REPLICAS} (got '${READY:-0}')"

TPL_APP="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.spec.template.metadata.labels.app}' 2>/dev/null || true)"
TPL_TIER="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.spec.template.metadata.labels.tier}' 2>/dev/null || true)"
[[ "$TPL_APP" == "$WANT_APP" ]] || fail "pod template label app must be ${WANT_APP} (got '${TPL_APP}')"
[[ "$TPL_TIER" == "$WANT_TIER" ]] || fail "pod template label tier must be ${WANT_TIER} (got '${TPL_TIER}')"

NCONT="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{range .spec.template.spec.containers[*]}{.name}{"\n"}{end}' 2>/dev/null | wc -l | tr -d ' ')"
[[ "${NCONT:-0}" -ge 2 ]] || fail "deployment must have at least 2 containers (got ${NCONT:-0})"

# Find containers by name
MAIN_IMG=""
SIDE_IMG=""
MAIN_CPU=""
MAIN_MEM=""
MAIN_LIM_CPU=""
MAIN_LIM_MEM=""
SIDE_CPU=""
SIDE_MEM=""
SIDE_LIM_CPU=""
SIDE_LIM_MEM=""
MAIN_MOUNT=""
SIDE_MOUNT=""
while IFS= read -r cname; do
  [[ -z "$cname" ]] && continue
  img="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath="{range .spec.template.spec.containers[?(@.name==\"$cname\")]}{.image}{end}" 2>/dev/null || true)"
  cpu="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath="{range .spec.template.spec.containers[?(@.name==\"$cname\")]}{.resources.requests.cpu}{end}" 2>/dev/null || true)"
  mem="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath="{range .spec.template.spec.containers[?(@.name==\"$cname\")]}{.resources.requests.memory}{end}" 2>/dev/null || true)"
  lim_cpu="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath="{range .spec.template.spec.containers[?(@.name==\"$cname\")]}{.resources.limits.cpu}{end}" 2>/dev/null || true)"
  lim_mem="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath="{range .spec.template.spec.containers[?(@.name==\"$cname\")]}{.resources.limits.memory}{end}" 2>/dev/null || true)"
  mnt="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath="{range .spec.template.spec.containers[?(@.name==\"$cname\")].volumeMounts[?(@.name==\"order-logs\")]}{.mountPath}{end}" 2>/dev/null || true)"
  if [[ "$cname" == "order-processor" ]]; then
    MAIN_IMG="$img"; MAIN_CPU="$cpu"; MAIN_MEM="$mem"; MAIN_LIM_CPU="$lim_cpu"; MAIN_LIM_MEM="$lim_mem"; MAIN_MOUNT="$mnt"
  elif [[ "$cname" == "log-shipper" ]]; then
    SIDE_IMG="$img"; SIDE_CPU="$cpu"; SIDE_MEM="$mem"; SIDE_LIM_CPU="$lim_cpu"; SIDE_LIM_MEM="$lim_mem"; SIDE_MOUNT="$mnt"
  fi
done < <(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{range .spec.template.spec.containers[*]}{.name}{"\n"}{end}' 2>/dev/null || true)

[[ -n "$MAIN_IMG" ]] || fail "container order-processor not found"
[[ -n "$SIDE_IMG" ]] || fail "container log-shipper not found"
[[ "$MAIN_IMG" == "$WANT_IMAGE" ]] || fail "order-processor image must be ${WANT_IMAGE} (got '${MAIN_IMG}')"
[[ "$SIDE_IMG" == "$WANT_SIDECAR_IMAGE" ]] || fail "log-shipper image must be ${WANT_SIDECAR_IMAGE} (got '${SIDE_IMG}')"
case "$MAIN_CPU" in 50m|0.05) ;; *) fail "order-processor cpu request must be 50m (got '${MAIN_CPU}')" ;; esac
case "$MAIN_LIM_CPU" in 50m|0.05) ;; *) fail "order-processor cpu limit must be 50m (got '${MAIN_LIM_CPU}')" ;; esac
[[ "$MAIN_MEM" == "128Mi" ]] || fail "order-processor memory request must be 128Mi (got '${MAIN_MEM}')"
[[ "$MAIN_LIM_MEM" == "128Mi" ]] || fail "order-processor memory limit must be 128Mi (got '${MAIN_LIM_MEM}')"
case "$SIDE_CPU" in 50m|0.05) ;; *) fail "log-shipper cpu request must be 50m (got '${SIDE_CPU}')" ;; esac
case "$SIDE_LIM_CPU" in 50m|0.05) ;; *) fail "log-shipper cpu limit must be 50m (got '${SIDE_LIM_CPU}')" ;; esac
[[ "$SIDE_MEM" == "64Mi" ]] || fail "log-shipper memory request must be 64Mi (got '${SIDE_MEM}')"
[[ "$SIDE_LIM_MEM" == "64Mi" ]] || fail "log-shipper memory limit must be 64Mi (got '${SIDE_LIM_MEM}')"
[[ "$MAIN_MOUNT" == "/var/log/orders" ]] || fail "order-processor must mount order-logs at /var/log/orders (got '${MAIN_MOUNT}')"
[[ "$SIDE_MOUNT" == "/var/log/orders" ]] || fail "log-shipper must mount order-logs at /var/log/orders (got '${SIDE_MOUNT}')"

# volume order-logs emptyDir
VOL="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{range .spec.template.spec.volumes[?(@.name=="order-logs")]}{.emptyDir}{end}' 2>/dev/null || true)"
# emptyDir may serialize as map or empty — presence of volume name is enough if emptyDir key exists
HAS_VOL="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o json | grep -c '"name": "order-logs"' || true)"
[[ "${HAS_VOL:-0}" -ge 1 ]] || fail "volume order-logs (emptyDir) must be defined"
echo "$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o json)" | grep -q '"emptyDir"' || fail "volume order-logs must be type emptyDir"

# no initContainers for shipper
INIT="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{range .spec.template.spec.initContainers[*]}{.name}{"\n"}{end}' 2>/dev/null || true)"
echo "$INIT" | grep -q "log-shipper" && fail "log-shipper must be a sidecar container, not an Init Container" || true

PORT="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{range .spec.template.spec.containers[?(@.name=="order-processor")].ports[*]}{.containerPort}{end}' 2>/dev/null || true)"
[[ "$PORT" == *"8000"* ]] || fail "order-processor containerPort must include 8000 (got '${PORT}')"

READY_PODS=0
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  name="$(echo "$line" | awk '{print $1}')"
  ready="$(echo "$line" | awk '{print $2}')"
  phase="$(echo "$line" | awk '{print $3}')"
  [[ "$phase" == "Running" ]] || fail "pod/${name} phase must be Running (got '${phase}')"
  [[ "$ready" == "2/2" ]] || fail "pod/${name} must be Ready 2/2 (got '${ready}')"
  READY_PODS=$((READY_PODS + 1))
done < <(kubectl -n "$LEARNER_NS" get pods -l "app=${WANT_APP},tier=${WANT_TIER}" --no-headers 2>/dev/null || true)
[[ "$READY_PODS" -ge "$WANT_REPLICAS" ]] || fail "need ${WANT_REPLICAS} Ready 2/2 pods (got ${READY_PODS})"

pass "deployment/${DEPLOY} has sidecar log-shipper sharing order-logs in ${LEARNER_NS}"
