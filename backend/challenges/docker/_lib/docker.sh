# Shared helpers for Docker-lab setup.sh / grade.sh. Sourced, not run.
#
# A Docker box is a Linux box running dockerd, so everything in the Linux lab.sh applies
# (in_box, box_script, as_learner, box_write, answer, fail/pass/ok). Docker commands run as
# root inside the box, against the learner's own dockerd.
#
# Grader-owned containers and images are named dl-grade-*; grade_cleanup removes them.

source "$(dirname "${BASH_SOURCE[0]}")/../../linux/_lib/lab.sh"

DOCKER_ASSETS="$(cd "$(dirname "${BASH_SOURCE[0]}")/../_assets" && pwd)"

# dk <docker args...> — run docker inside the box; prints its output.
dk() {
  in_box "docker $(printf '%q ' "$@")"
}

# dk_ok <docker args...> — true when the docker command succeeds (output hidden).
dk_ok() {
  dk "$@" >/dev/null 2>&1
}

# wait_docker — until dockerd answers (the box's readiness already waits for it).
wait_docker() {
  box_ok 'for i in $(seq 60); do docker info >/dev/null 2>&1 && exit 0; sleep 1; done; exit 1' \
    || fail "Docker is not running on this machine (systemctl status docker)"
}

# prepull <image>... — pull through the registry mirror so the learner's first run is fast.
prepull() {
  local img
  for img in "$@"; do
    dk pull -q "$img" >/dev/null || fail "could not pull $img (registry mirror down?)"
  done
}

# inspect <container|image> <go-template> — docker inspect -f; empty when it doesn't exist.
inspect() {
  dk inspect -f "$2" "$1" 2>/dev/null || true
}

# inspect_jq <container|image|volume|network> <jq filter> — docker inspect through jq (.[0]).
inspect_jq() {
  in_box "docker inspect $(printf '%q' "$1") 2>/dev/null | jq -r $(printf '%q' ".[0] | $2")" 2>/dev/null || true
}

container_exists() { dk_ok container inspect "$1"; }
image_exists() { dk_ok image inspect "$1"; }

# container_state <name> — created | running | exited | ... (empty when missing).
container_state() { inspect "$1" '{{.State.Status}}'; }

# container_health <name> — starting | healthy | unhealthy (empty without a HEALTHCHECK).
container_health() { inspect "$1" '{{if .State.Health}}{{.State.Health.Status}}{{end}}'; }

# container_env <name> <VAR> — effective value of VAR in the container's config (empty when
# unset). --env-file plus -e leaves duplicates in .Config.Env; the last one wins.
container_env() {
  inspect "$1" '{{range .Config.Env}}{{println .}}{{end}}' | sed -n "s/^$2=//p" | tail -n1
}

# published_port <name> <container-port> — host port it is published on (empty when not).
published_port() {
  inspect "$1" "{{with index .NetworkSettings.Ports \"$2/tcp\"}}{{(index . 0).HostPort}}{{end}}"
}

# wait_health <name> <status> <seconds> — true once the container reports that status.
wait_health() {
  local name=$1 want=$2 secs=$3 i
  for ((i = 0; i < secs; i++)); do
    [[ "$(container_health "$name")" == "$want" ]] && return 0
    sleep 1
  done
  return 1
}

# box_http <url> — GET from inside the box (retries for a few seconds); prints the body.
box_http() {
  in_box "for i in 1 2 3 4 5 6 7 8; do curl -fsS --max-time 3 '$1' && exit 0; sleep 1; done; exit 1" 2>/dev/null
}

# box_json <url> <jq filter> — GET from inside the box (with retries), print one JSON field.
box_json() {
  in_box "for i in 1 2 3 4 5 6 7 8; do out=\$(curl -fsS --max-time 3 '$1') && printf '%s' \"\$out\" | jq -r '$2' && exit 0; sleep 1; done; exit 1" 2>/dev/null
}

# http_code <method> <url> [json body] — HTTP status of one request from inside the box.
http_code() {
  in_box "curl -s -o /dev/null -w '%{http_code}' --max-time 5 -X $1 -H 'Content-Type: application/json' ${3:+-d '$3'} '$2'" 2>/dev/null || true
}

# compose_container <project> <service> — ID of the service's first container (empty if none).
compose_container() {
  dk ps -aq --filter "label=com.docker.compose.project=$1" \
    --filter "label=com.docker.compose.service=$2" 2>/dev/null | head -n1
}

# box_copy_dir <local dir> <dir in box> [owner] — copy a directory tree into the box.
box_copy_dir() {
  local src=$1 dest=$2 owner=${3:-learner:learner}
  in_box "install -d -o ${owner%%:*} -g ${owner##*:} '$dest'"
  COPYFILE_DISABLE=1 tar -C "$src" --no-xattrs -cf - . \
    | kubectl -n "$LEARNER_NS" exec -i "$BOX_POD" -c "$BOX_CONTAINER" -- \
      bash -c "tar -C '$dest' --no-same-owner --warning=no-unknown-keyword -xf - && chown -R $owner '$dest'"
}

# fresh_answers — an empty ~/answers owned by the learner (editors can't create parent dirs).
fresh_answers() {
  in_box 'rm -rf /home/learner/answers && install -d -o learner -g learner /home/learner/answers'
}

# grade_cleanup — remove grader-owned containers and images (call via trap in grade.sh).
grade_cleanup() {
  in_box 'ids=$(docker ps -aq --filter name=^dl-grade-); [ -z "$ids" ] || docker rm -f $ids >/dev/null 2>&1; true' \
    >/dev/null 2>&1 || true
}
