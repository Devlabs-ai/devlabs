# QuickByte Notification Service (lab image)

## Build & push (multi-arch: arm64 learner nodes + amd64)

```bash
# v1.0, plus v1.1 for the canary / blue-green labs
./images/build-all.sh notification-service
```

EKS nodes pull from Docker Hub; keep the repo **public** (or configure pull secrets).

## Endpoints

- `GET /health` → 200 (`version` mirrors `APP_VERSION`)
- `POST /notify` → 202 queued message stub
