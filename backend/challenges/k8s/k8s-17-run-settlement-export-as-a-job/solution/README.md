# Solution — Run Settlement Export as a Job

Stay in your lab namespace. Run a one-shot Job under ServiceAccount `settlement-exporter` (from the previous lab) to list Payment Handler Pods.

Docs: [Jobs](https://kubernetes.io/docs/concepts/workloads/controllers/job/)

## Solution YAML

Save as `settlement-export-job-l17.yaml`:

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: settlement-export
spec:
  completions: 1
  template:
    spec:
      serviceAccountName: settlement-exporter
      restartPolicy: OnFailure
      containers:
        - name: exporter
          image: bitnami/kubectl:latest
          command: ["kubectl", "get", "pods", "-l", "app=payment-handler", "-o", "wide"]
```

## Declarative

```bash
kubectl apply -f settlement-export-job-l17.yaml
kubectl wait --for=condition=complete job/settlement-export --timeout=120s
kubectl get job settlement-export
```

Wait until the Job is **Complete**, then **Submit**. Do not use the `default` ServiceAccount.
