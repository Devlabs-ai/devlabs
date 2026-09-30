# Solution — Colocate Notifications Near Orders

During peak order traffic, prefer Notification on the same node as Order Processor (`podAffinity`, soft) so confirmations do not lag across the fabric. Still schedule elsewhere if that node is full.

Docs: [DevSetu Blog — Where Pods Land: Selectors, Affinity, and Taints](/play/devops-engineer/kubernetes/read/scheduling-affinity-taints) · [Inter-pod affinity](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/#inter-pod-affinity-and-anti-affinity)

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
          image: devsetu/notification-service:v1.0
          ports:
            - containerPort: 8080
```

## Declarative

```bash
kubectl apply -f notification-podaffinity-l27.yaml
kubectl get deploy notification-service -o yaml | grep -A30 podAffinity
kubectl get pods -l 'app in (notification-service,order-processor)' -o wide
```

Wait until **2/2** Notification Pods are Ready, then **Submit**.
