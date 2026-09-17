#!/usr/bin/env bash
# Grade k8s-09 — Init Container migrates real Postgres schema before app starts.
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
DB_DEPLOY="orders-db"
DB_SVC="orders-db"
WANT_REPLICAS="2"
WANT_APP="order-processor"
WANT_TIER="app"
WANT_IMAGE="rithvikreddyalkanti/order-processor:v1.2"
WANT_INIT_IMAGE="postgres:16-alpine"

if ! kubectl -n "$LEARNER_NS" get deploy "$DB_DEPLOY" >/dev/null 2>&1; then
  fail "deployment/${DB_DEPLOY} not found (Postgres should be seeded by lab setup)"
fi
if ! kubectl -n "$LEARNER_NS" get svc "$DB_SVC" >/dev/null 2>&1; then
  fail "service/${DB_SVC} not found (Postgres Service should be seeded by lab setup)"
fi

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

INIT_COUNT="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.spec.template.spec.initContainers[*].name}' 2>/dev/null | wc -w | tr -d ' ')"
[[ "${INIT_COUNT:-0}" -ge 1 ]] || fail "deployment must define at least one initContainer"

INIT_NAME="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.spec.template.spec.initContainers[0].name}' 2>/dev/null || true)"
INIT_IMG="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.spec.template.spec.initContainers[0].image}' 2>/dev/null || true)"
INIT_CPU="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.spec.template.spec.initContainers[0].resources.requests.cpu}' 2>/dev/null || true)"
INIT_MEM="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.spec.template.spec.initContainers[0].resources.requests.memory}' 2>/dev/null || true)"
[[ "$INIT_NAME" == "schema-migrate" ]] || fail "init container name must be schema-migrate (got '${INIT_NAME}')"
[[ "$INIT_IMG" == "$WANT_INIT_IMAGE" ]] || fail "init image must be ${WANT_INIT_IMAGE} (got '${INIT_IMG}')"
case "$INIT_CPU" in 50m|0.05) ;; *) fail "init cpu request must be 50m (got '${INIT_CPU}')" ;; esac
[[ "$INIT_MEM" == "64Mi" ]] || fail "init memory request must be 64Mi (got '${INIT_MEM}')"

# Init must talk to Postgres (host + migrate tooling / DDL).
INIT_CMD="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.spec.template.spec.initContainers[0].command[*]} {.spec.template.spec.initContainers[0].args[*]}' 2>/dev/null || true)"
echo "$INIT_CMD" | grep -qi 'orders-db' || fail "init command/args must target host orders-db"
echo "$INIT_CMD" | grep -Eqi 'psql|pg_isready|CREATE TABLE' || fail "init command/args must run a real migrate (psql / pg_isready / CREATE TABLE)"

MAIN="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.spec.template.spec.containers[0].name}' 2>/dev/null || true)"
MAIN_IMG="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || true)"
CPU_REQ="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.spec.template.spec.containers[0].resources.requests.cpu}' 2>/dev/null || true)"
MEM_REQ="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.spec.template.spec.containers[0].resources.requests.memory}' 2>/dev/null || true)"
PORTS="$(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{.spec.template.spec.containers[0].ports[*].containerPort}' 2>/dev/null || true)"
[[ "$MAIN" == "order-processor" ]] || fail "main container must be order-processor (got '${MAIN}')"
[[ "$MAIN_IMG" == "$WANT_IMAGE" ]] || fail "image must be ${WANT_IMAGE} (got '${MAIN_IMG}')"
case "$CPU_REQ" in 100m|0.1) ;; *) fail "cpu request must be 100m (got '${CPU_REQ}')" ;; esac
[[ "$MEM_REQ" == "128Mi" ]] || fail "memory request must be 128Mi (got '${MEM_REQ}')"
[[ "$PORTS" == *"8000"* ]] || fail "containerPort must include 8000"

while IFS= read -r cname; do
  [[ "$cname" == "schema-migrate" ]] && fail "schema-migrate must be an Init Container, not a regular container"
done < <(kubectl -n "$LEARNER_NS" get deploy "$DEPLOY" -o jsonpath='{range .spec.template.spec.containers[*]}{.name}{"\n"}{end}' 2>/dev/null || true)

READY_PODS=0
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  name="$(echo "$line" | awk '{print $1}')"
  ready="$(echo "$line" | awk '{print $2}')"
  phase="$(echo "$line" | awk '{print $3}')"
  [[ "$phase" == "Running" ]] || fail "pod/${name} phase must be Running (got '${phase}')"
  [[ "$ready" == "1/1" ]] || fail "pod/${name} must be Ready 1/1 (got '${ready}')"
  READY_PODS=$((READY_PODS + 1))
done < <(kubectl -n "$LEARNER_NS" get pods -l "app=${WANT_APP},tier=${WANT_TIER}" --no-headers 2>/dev/null || true)
[[ "$READY_PODS" -ge "$WANT_REPLICAS" ]] || fail "need ${WANT_REPLICAS} Ready pods (got ${READY_PODS})"

# Prove migrate actually landed tables in Postgres.
TABLES="$(kubectl -n "$LEARNER_NS" exec "deploy/${DB_DEPLOY}" -- \
  env PGPASSWORD=quickbyte \
  psql -U postgres -d orders -tAc \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('orders','order_items');" \
  2>/dev/null | tr -d '[:space:]' || true)"
[[ "$TABLES" == "2" ]] || fail "Postgres must have tables orders and order_items (got count '${TABLES:-}')"

pass "deployment/${DEPLOY} runs schema-migrate init against orders-db; tables present in ${LEARNER_NS}"
