#!/usr/bin/env bash
# ~/order-processor as a real working copy: source, wheels, plus git metadata, logs, tests,
# bytecode and a .env holding a key. The Dockerfile copies everything before installing.
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/docker.sh"

key="pk_live_$(printf '%04x%04x%04x' $RANDOM $RANDOM $RANDOM)"

wait_docker
prepull python:3.12-slim

in_box 'rm -rf /home/learner/order-processor'
box_copy_dir "$DOCKER_ASSETS/order-processor" /home/learner/order-processor
box_script <<EOF
cd /home/learner/order-processor
cp -r /opt/devsetu/wheelhouse wheels
mkdir -p .git/objects logs tests __pycache__
echo 'ref: refs/heads/main' > .git/HEAD
head -c 8M /dev/urandom > .git/objects/pack-3f9a.pack
seq 1 40000 | awk '{ printf "2026-10-01T09:%02d:00 INFO created ORD-%08X\n", \$1 % 60, \$1 }' > logs/orders.log
printf 'def test_health():\n    assert True\n' > tests/test_app.py
head -c 4K /dev/urandom > __pycache__/app.cpython-312.pyc
printf 'PAYMENT_API_KEY=$key\nLOG_LEVEL=DEBUG\n' > .env
cat > Dockerfile <<'DOCKERFILE'
FROM python:3.12-slim

WORKDIR /app

COPY . .
RUN pip install --no-cache-dir --no-index --find-links=wheels -r requirements.txt

ENV APP_VERSION=v1.5
EXPOSE 8000

CMD ["gunicorn", "--bind", "0.0.0.0:8000", "--workers", "1", "--threads", "2", "app:app"]
DOCKERFILE
chown -R learner:learner /home/learner/order-processor
EOF
fresh_answers
ok "~/order-processor ready"
