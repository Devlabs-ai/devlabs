# Solution — Scale Out with a ReplicaSet

Stay in your lab namespace. Create ReplicaSet `order-processor-rs` with **3** replicas so Order Processor runs as a managed group of identical Pods (not a Deployment yet).

Docs: [ReplicaSet](https://kubernetes.io/docs/concepts/workloads/controllers/replicaset/)

## Solution YAML

Save as `order-processor-rs-l2.yaml` (Scratch pad or a file in your lab home):

```yaml
apiVersion: apps/v1
kind: ReplicaSet
metadata:
  name: order-processor-rs
spec:
  replicas: 3
  selector:
    matchLabels:
      app: order-processor
      version: v1.0
  template:
    metadata:
      labels:
        app: order-processor
        version: v1.0
    spec:
      containers:
        - name: order-processor
          image: rithvikreddyalkanti/order-processor:v1.0
          ports:
            - containerPort: 8000
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
```

Selector labels must match the Pod template labels (`app=order-processor`, `version=v1.0`).

## Declarative

Apply the manifest, then check replicas:

```bash
kubectl apply -f order-processor-rs-l2.yaml
kubectl get rs order-processor-rs
kubectl get pods -l app=order-processor,version=v1.0 -o wide
```

Wait until **3** Pods are `Running` and `READY` is `1/1` each, then **Submit**.

Do not create a Deployment — that is the next challenge. Work only in your lab namespace (not `default`).
