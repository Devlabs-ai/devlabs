# Solution — Prefer Notification Nodes Softly

Update `notification-service` with preferred (soft) node affinity for `workload=notifications`. Do not add a required rule.

Docs: [Node affinity](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/#node-affinity)

## Solution YAML

Save as `notification-nodeaffinity-l26.yaml`:

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
      affinity:
        nodeAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
            - weight: 100
              preference:
                matchExpressions:
                  - key: workload
                    operator: In
                    values:
                      - notifications
      containers:
        - name: notification-service
          image: rithvikreddyalkanti/notification-service:v1.0
          ports:
            - containerPort: 8080
```

## Declarative

```bash
kubectl apply -f notification-nodeaffinity-l26.yaml
kubectl get deploy notification-service -o yaml | grep -A20 affinity
kubectl get pods -l app=notification-service -o wide
```

Wait until **2/2** Pods are Ready, then **Submit**.
