#!/usr/bin/env bash
# ~/order-processor with the source, the offline wheelhouse and lab 03's working
# Dockerfile (1.3), which has no HEALTHCHECK yet.
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/docker.sh"

wait_docker
prepull python:3.12-slim

in_box 'rm -rf /home/learner/order-processor /home/learner/answers'
box_copy_dir "$DOCKER_ASSETS/order-processor" /home/learner/order-processor
box_script <<'EOF'
cp -r /opt/devsetu/wheelhouse /home/learner/order-processor/wheels
cat > /home/learner/order-processor/Dockerfile <<'DOCKERFILE'
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
COPY wheels/ ./wheels/
RUN pip install --no-cache-dir --no-index --find-links=wheels -r requirements.txt \
    && rm -rf wheels

COPY app.py .

ENV APP_VERSION=v1.3
EXPOSE 8000

CMD ["gunicorn", "--bind", "0.0.0.0:8000", "--workers", "1", "--threads", "2", "app:app"]
DOCKERFILE
chown -R learner:learner /home/learner/order-processor
EOF
fresh_answers
ok "source and Dockerfile in ~/order-processor"
