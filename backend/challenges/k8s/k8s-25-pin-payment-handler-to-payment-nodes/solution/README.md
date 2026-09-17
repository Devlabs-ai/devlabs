# Solution — Pin Payment Handler to Payment Nodes

Update Deployment `payment-handler` with a hard `nodeSelector` so replicas only land on nodes labeled `workload=payments`.

Docs: [Assigning Pods to Nodes](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/)

## Solution YAML

Save as `payment-handler-nodeselector-l25.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-handler
spec:
  replicas: 2
  selector:
    matchLabels:
      app: payment-handler
  template:
    metadata:
      labels:
        app: payment-handler
    spec:
      nodeSelector:
        workload: payments
      containers:
        - name: payment-handler
          image: rithvikreddyalkanti/payment-handler:v1.0
          ports:
            - containerPort: 8000
```

## Declarative

```bash
kubectl apply -f payment-handler-nodeselector-l25.yaml
kubectl get deploy payment-handler -o wide
kubectl get pods -l app=payment-handler -o wide
```

Wait until **2/2** Pods are Ready on payment-labeled nodes, then **Submit**. Use `nodeSelector` only (no affinity/taints).
