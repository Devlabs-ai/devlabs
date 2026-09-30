# QuickByte Order Reconciliation (lab batch image)

Minimal one-shot binary for Kubernetes Job / CronJob labs.

- Entry: `/reconciliation [--mode=full]`
- Exits 0 after a short simulated run

## Build & push (linux/amd64 for EKS)

```bash
cd images/order-reconciliation
docker build --platform linux/amd64 -t docker.io/devsetu/order-reconciliation:v1.0 .
docker push docker.io/devsetu/order-reconciliation:v1.0
```
