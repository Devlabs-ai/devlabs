# Zombie Order Processor (liveness lab)

Lab-only image: process stays **Running**, but `GET /health` **hangs** on the
first container incarnation. Mount an `emptyDir` at `/var/run/zombie` so a
marker survives restart; after kubelet restarts the container, `/health` is healthy.

Image: `devsetu/zombie-order-processor:1.0`

```bash
./images/build-all.sh zombie-order-processor   # multi-arch: arm64 + amd64
```
