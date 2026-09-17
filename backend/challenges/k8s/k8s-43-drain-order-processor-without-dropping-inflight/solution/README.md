# Solution — Drain Order Processor Without Dropping Inflight Work

Stay in your lab namespace. Give Order Processor a graceful shutdown (`terminationGracePeriodSeconds` + `preStop`) and a PDB so drains keep enough replicas.

Docs: [Container lifecycle hooks](https://kubernetes.io/docs/concepts/containers/container-lifecycle-hooks/) · [Pod Disruption Budgets](https://kubernetes.io/docs/tasks/run-application/configure-pdb/)

## Solution YAML

Save as `order-processor-graceful-l43.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-processor-deploy
spec:
  replicas: 4
  selector:
    matchLabels:
      app: order-processor
  template:
    metadata:
      labels:
        app: order-processor
    spec:
      terminationGracePeriodSeconds: 30
      containers:
        - name: order-processor
          image: rithvikreddyalkanti/order-processor:v1.0
          ports:
            - containerPort: 8000
          lifecycle:
            preStop:
              exec:
                command: ["/bin/sh", "-c", "sleep 5"]
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: order-processor-pdb
spec:
  minAvailable: 3
  selector:
    matchLabels:
      app: order-processor
```

## Declarative

```bash
kubectl apply -f order-processor-graceful-l43.yaml
kubectl rollout status deploy/order-processor-deploy
kubectl get pdb order-processor-pdb
```

Wait until Deployment is **4/4** Ready and the PDB exists with `minAvailable: 3`, then **Submit**. Do not set grace period to `0`.
