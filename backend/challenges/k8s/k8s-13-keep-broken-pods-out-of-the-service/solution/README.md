# Solution — Keep Broken Pods Out of the Service

Stay in your lab namespace. Update Deployment `order-processor-deploy` with an HTTP **readiness** probe on `/health` so half-booted Pods stay out of Service Endpoints.

Docs: [Readiness probe](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)

## Solution YAML

Save as `order-processor-readiness-l13.yaml`:

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
          readinessProbe:
            httpGet:
              path: /health
              port: 8000
            initialDelaySeconds: 5
            periodSeconds: 5
            failureThreshold: 3
```

## Declarative

```bash
kubectl apply -f order-processor-readiness-l13.yaml
kubectl get deploy order-processor-deploy
kubectl get pods -l app=order-processor
kubectl get endpoints order-processor-svc
```

Wait until **2** Pods are Ready and `order-processor-svc` has Endpoints, then **Submit**.

Do not remove the Service. Work only in your lab namespace (not `default`).
