# Solution — Nightly Order Reconciliation Job

Stay in your lab namespace. Create a one-shot Job for backfills and a CronJob for nightly reconciliation at 01:15.

Docs: [Jobs](https://kubernetes.io/docs/concepts/workloads/controllers/job/) · [CronJob](https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/)

## Solution YAML

Save as `order-reconciliation-job-l34.yaml`:

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: order-reconciliation-manual
spec:
  completions: 1
  template:
    spec:
      restartPolicy: OnFailure
      containers:
        - name: order-reconciliation
          image: rithvikreddyalkanti/order-reconciliation:v1.0
          command: ["/reconciliation", "--mode=full"]
```

Save as `order-reconciliation-cronjob-l34.yaml`:

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: order-reconciliation-nightly
spec:
  schedule: "15 1 * * *"
  concurrencyPolicy: Forbid
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: order-reconciliation
              image: rithvikreddyalkanti/order-reconciliation:v1.0
              command: ["/reconciliation", "--mode=full"]
```

## Declarative

```bash
kubectl apply -f order-reconciliation-job-l34.yaml
kubectl wait --for=condition=complete job/order-reconciliation-manual --timeout=120s
kubectl apply -f order-reconciliation-cronjob-l34.yaml
kubectl get job order-reconciliation-manual
kubectl get cronjob order-reconciliation-nightly
```

Wait until the manual Job is **Complete** and the CronJob shows schedule `15 1 * * *`, then **Submit**. Do not run this as a Deployment.
