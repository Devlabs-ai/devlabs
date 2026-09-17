# Solution — Rescue CrashLooping Notifications

Stay in your lab namespace. Inspect the broken Notification Service Deployment, fix the fault (image / command / env / probe), and restore **2/2** Ready.

Docs: [Debug running pods](https://kubernetes.io/docs/tasks/debug/debug-application/debug-running-pod/) · [Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)

## Solution YAML

Typical fix — restore a healthy Deployment (apply as `notification-service-fix-l41.yaml`):

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: notification-service
spec:
  replicas: 2
  selector:
    matchLabels:
      app: notification-service
  template:
    metadata:
      labels:
        app: notification-service
    spec:
      containers:
        - name: notification-service
          image: rithvikreddyalkanti/notification-service:v1.0
          ports:
            - containerPort: 8080
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
```

Start with `kubectl describe` / `kubectl logs` on the CrashLooping Pods — the actual break may be a bad image tag, wrong command, or a failing probe. Prefer patching the existing Deployment over creating a second one.

## Declarative

```bash
kubectl get pods -l app=notification-service
kubectl describe deploy/notification-service
kubectl logs -l app=notification-service --tail=50
kubectl apply -f notification-service-fix-l41.yaml
kubectl rollout status deploy/notification-service
```

Wait until **2/2** Ready with no CrashLoopBackOff / ImagePullBackOff, then **Submit**.
