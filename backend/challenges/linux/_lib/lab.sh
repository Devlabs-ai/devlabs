# Shared helpers for Linux-lab setup.sh / grade.sh. Sourced, not run.
#
# Scripts run on the backend host with controller kubectl (never inside the box), so
# the learner cannot alter the grader. Everything that touches the learner's machine
# goes through in_box / box_script, as root inside the box pod.
#
# Env from the backend: LEARNER_NS (lx-<user>), BOX_POD, BOX_CONTAINER, CHALLENGE_ID.
set -euo pipefail

: "${LEARNER_NS:?LEARNER_NS is required}"
BOX_POD="${BOX_POD:-box}"
BOX_CONTAINER="${BOX_CONTAINER:-box}"

# in_box '<shell command>' — run as root inside the box; prints its output.
in_box() {
  kubectl -n "$LEARNER_NS" exec "$BOX_POD" -c "$BOX_CONTAINER" -- bash -c "$1"
}

# box_script <<'EOF' ... EOF — run stdin as a root bash script inside the box.
box_script() {
  kubectl -n "$LEARNER_NS" exec -i "$BOX_POD" -c "$BOX_CONTAINER" -- bash -euo pipefail -s
}

# as_learner '<shell command>' — run as the learner (login shell) inside the box.
as_learner() {
  in_box "runuser -u learner -- bash -lc $(printf '%q' "$1")"
}

# box_ok '<shell command>' — true when the command succeeds inside the box (output hidden).
box_ok() {
  in_box "$1" >/dev/null 2>&1
}

# box_write <path> [mode] [owner] — copy stdin to a file inside the box.
box_write() {
  local path=$1 mode=${2:-644} owner=${3:-root:root}
  kubectl -n "$LEARNER_NS" exec -i "$BOX_POD" -c "$BOX_CONTAINER" -- \
    bash -c "install -d \"\$(dirname '$path')\" && cat > '$path' && chmod $mode '$path' && chown $owner '$path'"
}

# install_http_service <name> <version> <port-env-var> [bind-address]
# Installs /opt/<name>/bin/<name>, a storyline service stub serving GET /health. It
# refuses to run as root and exits with a clear message when its settings are missing.
# Optional env (baked in at install time):
#   REQUIRE="VAR ..."  extra env vars that must be set
#   STATE_DIR=/path    must be writable by the service user (else exit 4)
#   LOG_FILE=/path     kept open for append; heartbeat every 2s; write failure exits 5
install_http_service() {
  local name=$1 version=$2 portvar=$3 bind=${4:-127.0.0.1}
  sed -e "s|@NAME@|$name|g" -e "s|@VERSION@|$version|g" -e "s|@PORTVAR@|$portvar|g" \
      -e "s|@BIND@|$bind|g" -e "s|@REQUIRE@|${REQUIRE:-}|g" \
      -e "s|@STATE_DIR@|${STATE_DIR:-}|g" -e "s|@LOG_FILE@|${LOG_FILE:-}|g" <<'SH' |
#!/bin/bash
# @NAME@ @VERSION@ — serves GET /health on $@PORTVAR@.
set -u
REQUIRE='@REQUIRE@'
STATE_DIR='@STATE_DIR@'
LOG_FILE='@LOG_FILE@'
for v in @PORTVAR@ $REQUIRE; do
  if [ -z "${!v:-}" ]; then echo "@NAME@: $v is not set" >&2; exit 2; fi
done
port="$@PORTVAR@"
if [ "$(id -u)" -eq 0 ]; then echo "@NAME@: refusing to run as root" >&2; exit 3; fi
if [ -n "$STATE_DIR" ] && ! touch "$STATE_DIR/.alive" 2>/dev/null; then
  echo "@NAME@: cannot write to $STATE_DIR: Permission denied" >&2; exit 4
fi
if [ -n "$LOG_FILE" ]; then
  exec 3>>"$LOG_FILE" || { echo "@NAME@: cannot open $LOG_FILE" >&2; exit 5; }
fi
log() {
  echo "$*"
  if [ -n "$LOG_FILE" ]; then
    echo "$(date -u +%FT%TZ) $*" >&3 2>/dev/null || kill -USR1 $$
  fi
}
cleanup() { pkill -P $$ 2>/dev/null; }
trap 'echo "@NAME@: shutting down"; cleanup; exit 0' TERM INT
trap 'echo "@NAME@: cannot write $LOG_FILE (no space left on device?)" >&2; cleanup; exit 5' USR1
log "@NAME@ @VERSION@ listening on @BIND@:$port as $(id -un)"
if [ -n "$LOG_FILE" ]; then
  ( trap - TERM INT USR1; while sleep 2; do log "heartbeat ok" >/dev/null; done ) &
fi
body='{"status":"ok","service":"@NAME@","version":"@VERSION@"}'
fails=0
while :; do
  printf 'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: %s\r\nConnection: close\r\n\r\n%s' \
    "${#body}" "$body" | nc -l -N @BIND@ "$port" >/dev/null 2>&1 &
  if wait $!; then
    fails=0; log "GET /health 200" >/dev/null
  else
    fails=$((fails + 1))
    if [ "$fails" -ge 10 ]; then echo "@NAME@: cannot listen on @BIND@:$port (address in use?)" >&2; exit 1; fi
    sleep 0.3
  fi
done
SH
  box_write "/opt/$name/bin/$name" 755
}

# write_unit <name> — copy stdin to /lib/systemd/system/<name> (vendor unit) and reload.
write_unit() {
  box_write "/lib/systemd/system/$1" 644
  in_box 'systemctl daemon-reload'
}

# service_user <name> — system user + group with no login shell.
service_user() {
  in_box "id $1 >/dev/null 2>&1 || useradd --system --user-group --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin $1"
}

# answer <name> — the learner's answer file ~/answers/<name>, trailing whitespace trimmed.
answer() {
  in_box "test -f /home/learner/answers/$1 && sed -e 's/[[:space:]]*\$//' -e '/^\$/d' /home/learner/answers/$1" 2>/dev/null || true
}

# need_answer <name> <hint> — fail unless ~/answers/<name> exists.
need_answer() {
  box_ok "test -f /home/learner/answers/$1" || fail "~/answers/$1 does not exist ($2)"
}

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; exit 0; }
ok() { echo "ok: $*"; }
