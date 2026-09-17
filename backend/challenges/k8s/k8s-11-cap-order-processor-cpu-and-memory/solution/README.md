# Solution — Cap Order Processor CPU and Memory

Stay in your lab namespace. Update Deployment `order-processor-deploy` to keep existing requests and add limits **250m** CPU / **256Mi** memory.

Docs: [Resource limits](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/)

## Solution YAML

Save as `order-processor-resources-l11.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-processor-deploy
spec:
  replicas: 2
  selector:
    matchLabels:
      app: order-processor
  template:
    metadata:
      labels:
        app: order-processor
    spec:
      containers:
        - name: order-processor
          image: rithvikreddyalkanti/order-processor:v1.2
          ports:
            - containerPort: 8000
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
            limits:
              cpu: "250m"
              memory: "256Mi"
```

## Declarative

```bash
kubectl apply -f order-processor-resources-l11.yaml
kubectl get deploy order-processor-deploy
kubectl get pods -l app=order-processor
kubectl get pod -l app=order-processor -o jsonpath='{range .items[0].spec.containers[0].resources}{.limits}{end}'
```

Wait until **2** Pods are Ready, then **Submit**.

Do not remove requests. Work only in your lab namespace (not `default`).
