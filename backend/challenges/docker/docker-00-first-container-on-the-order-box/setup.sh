#!/usr/bin/env bash
# Pre-pulls alpine and leaves an exited batch container whose logs hold a per-session
# batch ID, so answers cannot be copied between learners.
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/docker.sh"

batch="B-$((RANDOM % 9000 + 1000))-$(printf '%04X' $RANDOM)"

wait_docker
prepull alpine:3.20

box_script <<EOF
docker rm -f old-batch scratchpad hello-once >/dev/null 2>&1 || true
docker run --name old-batch alpine:3.20 sh -c 'echo "starting nightly batch"; echo "BATCH-ID: $batch"; echo "processed 412 orders"; echo "done"' >/dev/null
install -d -m 700 /root/.lab
echo "$batch" > /root/.lab/batch-id
rm -rf /home/learner/answers
EOF
fresh_answers
ok "order box ready"
