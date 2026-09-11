#!/usr/bin/env bash
# End-to-end check: start the server, drive it with nc, compare the transcript.
#
# The tests in server_test.go dial from inside the process. This does it the way
# a user would, which catches things unit tests miss — binding the wrong
# interface, or a reply that never gets flushed.
set -euo pipefail

PORT="${PORT:-7400}"
BIN="${BIN:-bin/linesrv}"
# 127.0.0.1, not localhost: "localhost" resolves to ::1 first on many machines.
# Connecting over IPv6 to an IPv4 socket fails, and the failure looks like an
# empty reply.
HOST="127.0.0.1"

if ! command -v nc >/dev/null 2>&1; then
  echo "smoke: nc not found, skipping" >&2
  exit 0
fi

LINESRV_ADDR=":${PORT}" "${BIN}" &
SERVER_PID=$!
trap 'kill "${SERVER_PID}" 2>/dev/null || true' EXIT

for _ in $(seq 1 50); do
  if nc -z "${HOST}" "${PORT}" 2>/dev/null; then
    break
  fi
  sleep 0.1
done

actual="$(printf 'PING\r\nECHO hi\r\nQUIT\r\n' | nc "${HOST}" "${PORT}" | tr -d '\r')"
expected="$(printf 'PONG\nhi\nBYE')"

if [[ "${actual}" != "${expected}" ]]; then
  echo "smoke: FAIL" >&2
  echo "expected:" >&2
  echo "${expected}" >&2
  echo "actual:" >&2
  echo "${actual}" >&2
  exit 1
fi

echo "smoke: ok"
