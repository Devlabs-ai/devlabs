#!/usr/bin/env bash
# orders-db (Postgres) started without -v, so its data sits in an anonymous volume, seeded
# with a per-session number of orders and one marker order.
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/docker.sh"

count=$((RANDOM % 400 + 100))
marker="ORD-$(printf '%04X%04X' $RANDOM $RANDOM)"

wait_docker
prepull postgres:16-alpine alpine:3.20

box_script <<EOF
docker rm -f -v orders-db >/dev/null 2>&1 || true
docker run -d --name orders-db -e POSTGRES_PASSWORD=orders -e POSTGRES_USER=orders -e POSTGRES_DB=orders \
  postgres:16-alpine >/dev/null
for i in \$(seq 60); do docker exec orders-db pg_isready -U orders -d orders -h 127.0.0.1 >/dev/null 2>&1 && break; sleep 1; done
sleep 2
docker exec -i orders-db psql -q -U orders -d orders -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
CREATE TABLE orders (order_id text PRIMARY KEY, customer_id text, total numeric(10,2), created_at timestamptz DEFAULT now());
INSERT INTO orders (order_id, customer_id, total)
  SELECT 'ORD-' || lpad(to_hex(g), 8, '0'), 'c-' || (g % 97), round((random() * 90 + 10)::numeric, 2)
  FROM generate_series(1, $((count - 1))) g;
INSERT INTO orders (order_id, customer_id, total) VALUES ('$marker', 'c-42', 25.00);
SQL
install -d -m 700 /root/.lab
printf '%s %s\n' $count $marker > /root/.lab/orders
EOF
fresh_answers
ok "orders-db is running with $count orders"
