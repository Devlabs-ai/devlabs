#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/docker.sh"

wait_docker

container_exists payment-handler || fail "payment-handler is gone; it must keep running (Reset to start over)"

need_answer merchant-id "the MERCHANT_ID payment-handler runs with"
[[ "$(answer merchant-id)" == "$(container_env payment-handler MERCHANT_ID)" ]] \
  || fail "~/answers/merchant-id is not payment-handler's MERCHANT_ID (docker inspect, or docker exec ... env)"
ok "merchant ID"

need_answer payment-ip "payment-handler's IP address"
[[ "$(answer payment-ip)" == "$(inspect payment-handler '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}')" ]] \
  || fail "~/answers/payment-ip is not payment-handler's IP address (docker inspect payment-handler)"
ok "IP address"

box_ok "test -f /home/learner/answers/last-receipt.txt" \
  || fail "~/answers/last-receipt.txt does not exist (copy /tmp/last-receipt.txt out of the container)"
[[ "$(in_box 'cat /home/learner/answers/last-receipt.txt')" == "$(dk exec payment-handler cat /tmp/last-receipt.txt)" ]] \
  || fail "~/answers/last-receipt.txt doesn't match /tmp/last-receipt.txt inside payment-handler"
ok "receipt copied out"

[[ "$(container_state payment-handler)" == running ]] || fail "payment-handler is not running (docker start payment-handler)"
[[ "$(inspect payment-handler '{{.State.StartedAt}}')" != "$(in_box 'cat /root/.lab/started-at')" ]] \
  || fail "payment-handler has not been restarted since the lab started"
ok "payment-handler restarted and running"

need_answer settlement-exit-code "the exit code settlement-job stopped with"
[[ "$(answer settlement-exit-code)" == "$(in_box 'cat /root/.lab/settlement-code 2>/dev/null' || true)" ]] \
  || fail "~/answers/settlement-exit-code is not the code settlement-job exited with (docker ps -a, or docker inspect)"
ok "exit code"

! container_exists settlement-job || fail "remove settlement-job once you've recorded its exit code"
ok "settlement-job removed"

pass "you can look inside, copy from, restart and clean up containers"
