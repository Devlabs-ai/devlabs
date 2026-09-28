# QuickByte Notification Service (lab image)

## Build & push

```bash
cd images/notification-service
docker build --platform linux/amd64 -t devsetu/notification-service:v1.0 .
docker push devsetu/notification-service:v1.0

# Canary / blue-green labs need a distinct v1.1 tag
docker build --platform linux/amd64 --build-arg APP_VERSION=v1.1 \
  -t devsetu/notification-service:v1.1 .
docker push devsetu/notification-service:v1.1
```

EKS nodes pull from Docker Hub; keep the repo **public** (or configure pull secrets).

## Endpoints

- `GET /health` → 200 (`version` mirrors `APP_VERSION`)
- `POST /notify` → 202 queued message stub
