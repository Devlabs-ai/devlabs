# Solution — Canary the Notification Service

Keep stable `notification-service` on v1.0 at **3** replicas (`track=stable`) and add canary Deployment `notification-service-canary` with **1** replica on v1.1 (`track=canary`). The shared Service selector `app=notification-service` covers both tracks (**4** pods total).

Docs: [DevSetu Blog — Canary and Blue-Green Releases](/play/devops-engineer/kubernetes/read/canary-blue-green) · [Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)

## Solution YAML

Save as `notification-canary-l30.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: notification-service
spec:
  replicas: 3
  selector:
    matchLabels:
      app: notification-service
      track: stable
  template:
    metadata:
      labels:
        app: notification-service
        track: stable
    spec:
      containers:
        - name: notification-service
          image: devsetu/notification-service:v1.0
          ports:
            - containerPort: 8080
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: notification-service-canary
spec:
  replicas: 1
  selector:
    matchLabels:
      app: notification-service
      track: canary
  template:
    metadata:
      labels:
        app: notification-service
        track: canary
    spec:
      containers:
        - name: notification-service
          image: devsetu/notification-service:v1.1
          ports:
            - containerPort: 8080
```

## Declarative

```bash
kubectl apply -f notification-canary-l30.yaml
kubectl get deploy notification-service notification-service-canary
kubectl get endpoints notification-service
kubectl get pods -l app=notification-service -o wide
```

Wait until stable is **3/3**, canary is **1/1**, and the Service has ≥ 4 endpoint addresses, then **Submit**.
