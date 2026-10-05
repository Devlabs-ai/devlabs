#!/usr/bin/env bash
# Months of Docker leftovers: exited batch containers, dangling images from repeated
# builds, build cache, unused export volumes (one much bigger than the rest), and the
# orders-backup volume that must survive. order-processor keeps running.
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/docker.sh"

big="export-2026-09-$((RANDOM % 9 + 20))"

wait_docker
prepull alpine:3.20 devsetu/order-processor:v1.2

box_script <<EOF
docker rm -f order-processor >/dev/null 2>&1 || true
docker run -d --name order-processor --restart unless-stopped -p 8080:8000 devsetu/order-processor:v1.2 >/dev/null
for i in 1 2 3 4 5 6 7 8; do docker run --name batch-2026-09-0\$i alpine:3.20 sh -c "echo batch \$i done" >/dev/null; done

rm -rf /tmp/rb && mkdir -p /tmp/rb
for v in 1 2 3 4; do
  printf 'FROM alpine:3.20\nRUN dd if=/dev/urandom of=/report.bin bs=1M count=40 2>/dev/null && echo build-%s > /build\n' \$v > /tmp/rb/Dockerfile
  docker build -q -t quickbyte/report-builder:dev /tmp/rb >/dev/null
done
rm -rf /tmp/rb

for v in export-2026-09-20 export-2026-09-21 export-2026-09-22 export-2026-09-23 export-2026-09-24 export-2026-09-25 export-2026-09-26 export-2026-09-27 export-2026-09-28; do
  docker volume inspect \$v >/dev/null 2>&1 && continue
  docker volume create \$v >/dev/null
done
for v in \$(docker volume ls -q --filter name=export-2026-09-); do
  mb=8; [ "\$v" = "$big" ] && mb=120
  docker run --rm -v \$v:/data alpine:3.20 sh -c "dd if=/dev/urandom of=/data/orders.csv.gz bs=1M count=\$mb 2>/dev/null"
done
docker volume create --label com.quickbyte.keep=true orders-backup >/dev/null
docker run --rm -v orders-backup:/data alpine:3.20 sh -c 'dd if=/dev/urandom of=/data/orders-2026-10-01.sql.gz bs=1M count=2 2>/dev/null'
install -d -m 700 /root/.lab
docker run --rm -v orders-backup:/data alpine:3.20 md5sum /data/orders-2026-10-01.sql.gz | cut -d' ' -f1 > /root/.lab/backup-md5
echo "$big" > /root/.lab/big-volume
EOF
fresh_answers
ok "order box ready"
