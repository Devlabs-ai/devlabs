# Solution — Spread Payment Replicas Across Nodes

Scale `payment-handler` to **3** replicas and add preferred pod anti-affinity so replicas prefer different nodes.

Docs: [Inter-pod anti-affinity](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/#inter-pod-affinity-and-anti-affinity)

## Solution YAML

Save as `payment-antiaffinity-l28.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-handler
spec:
  replicas: 3
  selector:
    matchLabels:
      app: payment-handler
  template:
    metadata:
      labels:
        app: payment-handler
    spec:
      affinity:
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
            - weight: 100
              podAffinityTerm:
                topologyKey: kubernetes.io/hostname
                labelSelector:
                  matchLabels:
                    app: payment-handler
      containers:
        - name: payment-handler
          image: rithvikreddyalkanti/payment-handler:v1.0
          ports:
            - containerPort: 8000
```

## Declarative

```bash
kubectl apply -f payment-antiaffinity-l28.yaml
kubectl get deploy payment-handler
kubectl get pods -l app=payment-handler -o wide
```

Wait until **3/3** Pods are Ready, then **Submit**. Prefer soft anti-affinity so tiny clusters stay schedulable.
