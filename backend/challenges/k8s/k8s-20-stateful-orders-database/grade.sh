#!/usr/bin/env bash
# Grade k8s-20-stateful-orders-database — orders-db StatefulSet.
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

STS="orders-db"

kubectl -n "$LEARNER_NS" get sts "$STS" >/dev/null 2>&1 || fail "statefulset/${STS} not found"
if kubectl -n "$LEARNER_NS" get deploy "$STS" >/dev/null 2>&1; then
  fail "found Deployment/${STS} — this lab requires a StatefulSet"
fi

REPLICAS="$(kubectl -n "$LEARNER_NS" get sts "$STS" -o jsonpath='{.spec.replicas}' 2>/dev/null || true)"
READY="$(kubectl -n "$LEARNER_NS" get sts "$STS" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || true)"
SVC="$(kubectl -n "$LEARNER_NS" get sts "$STS" -o jsonpath='{.spec.serviceName}' 2>/dev/null || true)"
CNAME="$(kubectl -n "$LEARNER_NS" get sts "$STS" -o jsonpath='{.spec.template.spec.containers[0].name}' 2>/dev/null || true)"
IMAGE="$(kubectl -n "$LEARNER_NS" get sts "$STS" -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || true)"
PORT="$(kubectl -n "$LEARNER_NS" get sts "$STS" -o jsonpath='{.spec.template.spec.containers[0].ports[0].containerPort}' 2>/dev/null || true)"
APP="$(kubectl -n "$LEARNER_NS" get sts "$STS" -o jsonpath='{.spec.template.metadata.labels.app}' 2>/dev/null || true)"
TIER="$(kubectl -n "$LEARNER_NS" get sts "$STS" -o jsonpath='{.spec.template.metadata.labels.tier}' 2>/dev/null || true)"
VCT="$(kubectl -n "$LEARNER_NS" get sts "$STS" -o jsonpath='{.spec.volumeClaimTemplates[0].metadata.name}' 2>/dev/null || true)"
MP="$(kubectl -n "$LEARNER_NS" get sts "$STS" -o jsonpath='{.spec.template.spec.containers[0].volumeMounts[?(@.name=="data")].mountPath}' 2>/dev/null || true)"
PW="$(kubectl -n "$LEARNER_NS" get sts "$STS" -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="POSTGRES_PASSWORD")].value}' 2>/dev/null || true)"
DB="$(kubectl -n "$LEARNER_NS" get sts "$STS" -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="POSTGRES_DB")].value}' 2>/dev/null || true)"
CPU="$(kubectl -n "$LEARNER_NS" get sts "$STS" -o jsonpath='{.spec.template.spec.containers[0].resources.requests.cpu}' 2>/dev/null || true)"
MEM="$(kubectl -n "$LEARNER_NS" get sts "$STS" -o jsonpath='{.spec.template.spec.containers[0].resources.requests.memory}' 2>/dev/null || true)"

[[ "$REPLICAS" == "2" ]] || fail "replicas must be 2 (got '${REPLICAS}')"
[[ "$SVC" == "orders-db" ]] || fail "serviceName must be orders-db (got '${SVC}')"
[[ "$CNAME" == "postgres" ]] || fail "container name must be postgres (got '${CNAME}')"
[[ "$IMAGE" == "postgres:16-alpine" ]] || fail "image must be postgres:16-alpine (got '${IMAGE}')"
[[ "$PORT" == "5432" ]] || fail "containerPort must be 5432 (got '${PORT}')"
[[ "$APP" == "orders-db" ]] || fail "label app must be orders-db (got '${APP}')"
[[ "$TIER" == "data" ]] || fail "label tier must be data (got '${TIER}')"
[[ "$VCT" == "data" ]] || fail "volumeClaimTemplates[0].name must be data (got '${VCT}')"
[[ "$MP" == "/var/lib/postgresql/data" ]] || fail "data mountPath must be /var/lib/postgresql/data (got '${MP}')"
[[ "$PW" == "quickbyte-lab" ]] || fail "POSTGRES_PASSWORD must be quickbyte-lab"
[[ "$DB" == "orders" ]] || fail "POSTGRES_DB must be orders"
case "$CPU" in 100m|0.1) ;; *) fail "cpu request must be 100m (got '${CPU}')" ;; esac
[[ "$MEM" == "256Mi" ]] || fail "memory request must be 256Mi (got '${MEM}')"
[[ "${READY:-0}" == "2" ]] || fail "readyReplicas must be 2 (got '${READY:-0}')"

pass "statefulset/${STS} has 2 Ready replicas with volumeClaimTemplates in ${LEARNER_NS}"
