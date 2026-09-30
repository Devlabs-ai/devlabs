# Solution — Spread Payment Replicas Across Nodes

Keep `payment-handler` at **2** replicas and add preferred pod anti-affinity so replicas prefer different nodes.

Docs: [DevSetu Blog — Where Pods Land: Selectors, Affinity, and Taints](/play/devops-engineer/kubernetes/read/scheduling-affinity-taints) · [Inter-pod anti-affinity](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/#inter-pod-affinity-and-anti-affinity)

## Solution YAML

Save as `payment-antiaffinity-l28.yaml`:

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
          image: devsetu/payment-handler:v1.0
          ports:
            - containerPort: 8000
```

## Declarative

```bash
kubectl apply -f payment-antiaffinity-l28.yaml
kubectl get deploy payment-handler
kubectl get pods -l app=payment-handler -o wide
```

Wait until **2/2** Pods are Ready, then **Submit**. Prefer soft anti-affinity so tiny clusters stay schedulable.
