# Slow Order Processor (startup-probe lab)

Lab-only image: listens immediately, but **`GET /health` returns 503 for 25s**
(override with `BOOT_DELAY_SECONDS`). With aggressive liveness and **no** startup
probe, kubelet kills mid-warmup → CrashLoopBackOff.

Image: `devsetu/slow-order-processor:1.0`

```bash
cd images/slow-order-processor
docker build --platform linux/amd64 -t devsetu/slow-order-processor:1.0 .
docker push devsetu/slow-order-processor:1.0
```
