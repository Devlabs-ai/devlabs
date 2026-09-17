# Solution — Colocate Notifications Near Orders

Update `notification-service` with preferred pod affinity toward Pods labeled `app=order-processor` (`topologyKey: kubernetes.io/hostname`).

Docs: [Inter-pod affinity](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/#inter-pod-affinity-and-anti-affinity)

## Solution YAML

Save as `notification-podaffinity-l27.yaml`:

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
        podAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
            - weight: 100
              podAffinityTerm:
                topologyKey: kubernetes.io/hostname
                labelSelector:
                  matchLabels:
                    app: order-processor
      containers:
        - name: notification-service
          image: rithvikreddyalkanti/notification-service:v1.0
          ports:
            - containerPort: 8080
```

## Declarative

```bash
kubectl apply -f notification-podaffinity-l27.yaml
kubectl get deploy notification-service -o yaml | grep -A30 podAffinity
kubectl get pods -l app=notification-service -o wide
```

Wait until **2/2** Notification Pods are Ready, then **Submit**.
