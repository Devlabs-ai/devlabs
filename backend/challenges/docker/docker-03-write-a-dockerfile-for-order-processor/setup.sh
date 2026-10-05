#!/usr/bin/env bash
# Puts the order-processor source in ~/order-processor with an offline wheelhouse
# (boxes have no PyPI), and pre-pulls the base image.
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/docker.sh"

wait_docker
prepull python:3.12-slim

in_box 'rm -rf /home/learner/order-processor /home/learner/answers'
box_copy_dir "$DOCKER_ASSETS/order-processor" /home/learner/order-processor
box_script <<'EOF'
cp -r /opt/devsetu/wheelhouse /home/learner/order-processor/wheels
chown -R learner:learner /home/learner/order-processor
EOF
fresh_answers
ok "source in ~/order-processor"
