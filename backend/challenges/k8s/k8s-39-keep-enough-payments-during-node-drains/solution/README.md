# Solution — Keep Enough Payments During Node Drains

Stay in your lab namespace. Create a PodDisruptionBudget so voluntary drains cannot take Payment Handler below 3 available Pods.

Docs: [Pod Disruption Budgets](https://kubernetes.io/docs/tasks/run-application/configure-pdb/)

## Solution YAML

Save as `payment-handler-pdb-l39.yaml`:

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: payment-handler-pdb
spec:
  minAvailable: 3
  selector:
    matchLabels:
      app: payment-handler
```

## Declarative

```bash
kubectl apply -f payment-handler-pdb-l39.yaml
kubectl get pdb payment-handler-pdb
kubectl describe pdb payment-handler-pdb
```

Confirm `MIN AVAILABLE` is **3** and the selector matches payment Pods, then **Submit**. Use `minAvailable` (not `maxUnavailable`).
