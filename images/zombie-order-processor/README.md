# Zombie Order Processor (liveness lab)

Lab-only image: process stays **Running**, but `GET /health` **hangs** on the
first container incarnation. Mount an `emptyDir` at `/var/run/zombie` so a
marker survives restart; after kubelet restarts the container, `/health` is healthy.

Image: `devsetu/zombie-order-processor:1.0`

```bash
cd images/zombie-order-processor
docker build --platform linux/amd64 -t devsetu/zombie-order-processor:1.0 .
docker push devsetu/zombie-order-processor:1.0
```
