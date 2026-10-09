# QuickByte Payment Handler (lab workload image)

Minimal Flask service for Kubernetes CKAD labs.

- `POST /pay` → capture payment
- `GET /health` → `{"status":"ok","version":"…"}`
- Listens on **8000**
- Runs as UID **1000** (SecurityContext labs)

## Build & push (multi-arch: arm64 learner nodes + amd64)

```bash
# v1.0, plus v1.1 for the blue-green / canary labs
./images/build-all.sh payment-handler
```
