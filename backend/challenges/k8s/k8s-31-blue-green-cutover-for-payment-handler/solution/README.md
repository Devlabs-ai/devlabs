# Solution — Blue-Green Cutover for Payment Handler

Stay in your lab namespace. Bring up a full **green** Payment Handler stack on `v1.1`, then flip Service `payment-handler` to `color=green`. Leave blue running for rollback.

Docs: [Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/) · [Services](https://kubernetes.io/docs/concepts/services-networking/service/)

## Solution YAML

Save as `payment-handler-green-l31.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-handler-green
spec:
  replicas: 3
  selector:
    matchLabels:
      app: payment-handler
      color: green
  template:
    metadata:
      labels:
        app: payment-handler
        color: green
    spec:
      containers:
        - name: payment-handler
          image: rithvikreddyalkanti/payment-handler:v1.1
          ports:
            - containerPort: 8000
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
```

Save as `payment-handler-svc-l31.yaml` (cutover — selector points at green):

```yaml
apiVersion: v1
kind: Service
metadata:
  name: payment-handler
spec:
  selector:
    app: payment-handler
    color: green
  ports:
    - port: 8000
      targetPort: 8000
```

## Declarative

```bash
kubectl apply -f payment-handler-green-l31.yaml
kubectl rollout status deploy/payment-handler-green
kubectl apply -f payment-handler-svc-l31.yaml
kubectl get endpoints payment-handler
kubectl get pods -l app=payment-handler -L color
```

Wait until green is **3/3** Ready and endpoints list only green Pods, then **Submit**. Do not delete blue.
