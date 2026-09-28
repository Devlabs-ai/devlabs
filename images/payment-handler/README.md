# QuickByte Payment Handler (lab workload image)

Minimal Flask service for Kubernetes CKAD labs.

- `POST /pay` → capture payment
- `GET /health` → `{"status":"ok","version":"…"}`
- Listens on **8000**
- Runs as UID **1000** (SecurityContext labs)

## Build & push (linux/amd64 for EKS)

```bash
cd images/payment-handler

docker build --platform linux/amd64 \
  --build-arg APP_VERSION=v1.0 \
  -t devsetu/payment-handler:v1.0 .
docker push devsetu/payment-handler:v1.0

# Blue-green / canary labs need a distinct v1.1 tag
docker build --platform linux/amd64 \
  --build-arg APP_VERSION=v1.1 \
  -t devsetu/payment-handler:v1.1 .
docker push devsetu/payment-handler:v1.1
```
