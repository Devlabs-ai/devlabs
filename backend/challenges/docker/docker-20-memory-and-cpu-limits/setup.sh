#!/usr/bin/env bash
# quickbyte/report-builder:1.0 holds REPORT_BATCH_MB (default 300) MB of orders in
# memory while it builds the daily report.
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/docker.sh"

wait_docker
prepull python:3.12-slim devsetu/order-processor:v1.2

box_script <<'EOF'
docker rm -f report-big report-small order-processor >/dev/null 2>&1 || true
rm -rf /tmp/report && mkdir -p /tmp/report
cat > /tmp/report/report.py <<'PY'
import os, sys, time

batch_mb = int(os.environ.get("REPORT_BATCH_MB", "300"))
print(f"report-builder: loading {batch_mb} MB of orders", flush=True)
chunks = []
for i in range(batch_mb):
    chunks.append(b"\x01" * (1024 * 1024))
    if i % 50 == 49:
        print(f"report-builder: {i + 1} MB loaded", flush=True)
time.sleep(1)
print(f"report done: {batch_mb} MB processed", flush=True)
PY
cat > /tmp/report/Dockerfile <<'DOCKERFILE'
FROM python:3.12-slim
COPY report.py /report.py
USER 65534
CMD ["python", "/report.py"]
DOCKERFILE
docker build -q -t quickbyte/report-builder:1.0 /tmp/report >/dev/null
rm -rf /tmp/report
EOF
fresh_answers
ok "order box ready"
