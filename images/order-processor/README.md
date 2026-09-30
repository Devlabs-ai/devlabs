# QuickByte Order Processor (lab workload image)

Minimal Flask service for Kubernetes CKAD labs.

- `POST /orders` → create order (version-aware validation)
- `GET /health` → `{"status":"ok","version":"…"}`
- Listens on **8000**

## Tags

| Tag | Behavior |
| --- | --- |
| `v1.0` | Rejects orders with `total` &lt; 50 (baked-in “bug” for the rollout lab) |
| `v1.1` | Accepts small orders (fix). Same HTTP surface. |
| `v1.2` | Reads `MIN_ORDER_VALUE`, `MAX_ITEMS_PER_ORDER`, `LOG_LEVEL`, `PAYMENT_API_KEY` from env (ConfigMap / Secret labs) |

For the liveness “hung /health” demo see `../zombie-order-processor` (`zombie-order-processor:1.0`).

## Build & push (linux/amd64 for EKS)

```bash
cd images/order-processor

for TAG in v1.0 v1.1 v1.2; do
  docker build --platform linux/amd64 \
    --build-arg APP_VERSION=$TAG \
    -t devsetu/order-processor:$TAG .
  docker push devsetu/order-processor:$TAG
done
```
