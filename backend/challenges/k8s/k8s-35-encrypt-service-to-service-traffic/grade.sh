#!/usr/bin/env bash
# Grade k8s-35-encrypt-service-to-service-traffic — mesh mTLS policy.
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

SOFT_NOTES=()

# Prefer Istio PeerAuthentication; also accept namespace STRICT label patterns.
HAS_PA_CRD=0
if kubectl api-resources --api-group=security.istio.io 2>/dev/null | grep -q PeerAuthentication; then
  HAS_PA_CRD=1
fi

MTLS_OK=0
if [[ "$HAS_PA_CRD" -eq 1 ]]; then
  # Any PeerAuthentication in the namespace with STRICT (mtls.mode or spec.mtls.mode)
  while IFS= read -r name; do
    [[ -z "$name" ]] && continue
    MODE="$(kubectl -n "$LEARNER_NS" get peerauthentication "$name" -o jsonpath='{.spec.mtls.mode}' 2>/dev/null || true)"
    if [[ "$MODE" == "STRICT" ]]; then
      MTLS_OK=1
      break
    fi
  done < <(kubectl -n "$LEARNER_NS" get peerauthentication -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null || true)
  [[ "$MTLS_OK" -eq 1 ]] || fail "PeerAuthentication with mtls.mode=STRICT not found in ${LEARNER_NS}"
else
  SOFT_NOTES+=("Istio PeerAuthentication CRD absent")
fi

# DestinationRule for Service handler / payment-handler with ISTIO_MUTUAL (optional but preferred)
HAS_DR_CRD=0
if kubectl api-resources --api-group=networking.istio.io 2>/dev/null | grep -q DestinationRule; then
  HAS_DR_CRD=1
fi
DR_OK=0
if [[ "$HAS_DR_CRD" -eq 1 ]]; then
  while IFS= read -r name; do
    [[ -z "$name" ]] && continue
    HOST="$(kubectl -n "$LEARNER_NS" get destinationrule "$name" -o jsonpath='{.spec.host}' 2>/dev/null || true)"
    TLS="$(kubectl -n "$LEARNER_NS" get destinationrule "$name" -o jsonpath='{.spec.trafficPolicy.tls.mode}' 2>/dev/null || true)"
    if [[ "$TLS" == "ISTIO_MUTUAL" ]] && [[ "$HOST" == *"handler"* || "$HOST" == *"payment"* ]]; then
      DR_OK=1
      break
    fi
  done < <(kubectl -n "$LEARNER_NS" get destinationrule -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null || true)
  if [[ "$DR_OK" -eq 0 ]]; then
    SOFT_NOTES+=("DestinationRule ISTIO_MUTUAL for handler not found (optional)")
  fi
fi

# Injection label on namespace or workloads
INJECT="$(kubectl get ns "$LEARNER_NS" -o jsonpath='{.metadata.labels.istio-injection}' 2>/dev/null || true)"
REV="$(kubectl get ns "$LEARNER_NS" -o jsonpath='{.metadata.labels.istio\.io/rev}' 2>/dev/null || true)"
if [[ "$INJECT" != "enabled" && -z "$REV" ]]; then
  # check workload annotations/labels
  OP_INJ="$(kubectl -n "$LEARNER_NS" get deploy order-processor-deploy -o jsonpath='{.spec.template.metadata.labels.sidecar\.istio\.io/inject}' 2>/dev/null || true)"
  PH_INJ="$(kubectl -n "$LEARNER_NS" get deploy payment-handler -o jsonpath='{.spec.template.metadata.labels.sidecar\.istio\.io/inject}' 2>/dev/null || true)"
  if [[ "$OP_INJ" != "true" && "$PH_INJ" != "true" ]]; then
    SOFT_NOTES+=("mesh injection label not detected on namespace/workloads")
  fi
fi

# Workloads still Ready when present
for dep in order-processor-deploy payment-handler; do
  if kubectl -n "$LEARNER_NS" get deploy "$dep" >/dev/null 2>&1; then
    READY="$(kubectl -n "$LEARNER_NS" get deploy "$dep" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || true)"
    DESIRED="$(kubectl -n "$LEARNER_NS" get deploy "$dep" -o jsonpath='{.spec.replicas}' 2>/dev/null || true)"
    [[ "${READY:-0}" == "${DESIRED:-0}" && "${DESIRED:-0}" != "0" ]] || fail "deployment/${dep} must be Ready (${READY:-0}/${DESIRED})"
  fi
done

# If no Istio CRDs, accept Linkerd Server/ServerAuthorization OR fail clearly
if [[ "$HAS_PA_CRD" -eq 0 ]]; then
  if kubectl api-resources 2>/dev/null | grep -qi 'serverauthorization\|servers.policy.linkerd'; then
    # soft pass if any ServerAuthorization exists
    COUNT="$(kubectl -n "$LEARNER_NS" get serverauthorizations.policy.linkerd.io 2>/dev/null | wc -l | tr -d ' ')"
    [[ "${COUNT:-0}" -gt 1 ]] || fail "mesh CRDs for Istio absent and no Linkerd ServerAuthorization found"
    MTLS_OK=1
    SOFT_NOTES+=("graded Linkerd authz instead of Istio")
  else
    fail "No Istio/Linkerd mesh policy CRDs available — cannot verify STRICT mTLS. Apply PeerAuthentication when mesh is installed."
  fi
fi

SOFT=""
if [[ ${#SOFT_NOTES[@]} -gt 0 ]]; then
  SOFT=" (soft: ${SOFT_NOTES[*]})"
fi

pass "mesh mTLS STRICT policy present for Payment Handler path in ${LEARNER_NS}${SOFT}"
