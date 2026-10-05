# QuickByte Order Reconciliation (lab batch image)

Minimal one-shot binary for Kubernetes Job / CronJob labs.

- Entry: `/reconciliation [--mode=full]`
- Exits 0 after a short simulated run

## Build & push (multi-arch: arm64 learner nodes + amd64)

```bash
./images/build-all.sh order-reconciliation
```
