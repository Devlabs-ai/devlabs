# Slow Order Processor (startup-probe lab)

Lab-only image: listens immediately, but **`GET /health` returns 503 for 25s**
(override with `BOOT_DELAY_SECONDS`). With aggressive liveness and **no** startup
probe, kubelet kills mid-warmup → CrashLoopBackOff.

Image: `devsetu/slow-order-processor:1.0`

```bash
./images/build-all.sh slow-order-processor   # multi-arch: arm64 + amd64
```
