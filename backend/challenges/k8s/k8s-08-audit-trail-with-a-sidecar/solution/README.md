# Solution — Audit Trail with a Sidecar

Stay in your lab namespace. Update Deployment `order-processor-deploy` so each Pod runs **order-processor** plus a **log-shipper** sidecar sharing emptyDir `order-logs` at `/var/log/orders`. The `emptyDir` is declared once under `spec.volumes` and mounted into **both** containers via `volumeMounts`, so what `order-processor` writes, `log-shipper` can read.

Docs: [DevSetu Blog — Multi-Container Pods](/play/devops-engineer/kubernetes/read/multi-container-pods) · [Sidecar containers](https://kubernetes.io/docs/concepts/workloads/pods/sidecar-containers/)

## Solution YAML

Save as `order-processor-sidecar-l8.yaml`:

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
      tier: app
  template:
    metadata:
      labels:
        app: order-processor
        tier: app
    spec:
      volumes:
        - name: order-logs
          emptyDir: {}
      containers:
        - name: order-processor
          image: devsetu/order-processor:v1.2
          ports:
            - containerPort: 8000
          volumeMounts:
            - name: order-logs
              mountPath: /var/log/orders
        - name: log-shipper
          image: busybox:1.36
          command: ["/bin/sh", "-c", "tail -F /var/log/orders/orders.log 2>/dev/null || sleep 3600"]
          volumeMounts:
            - name: order-logs
              mountPath: /var/log/orders
```

## Declarative

```bash
kubectl apply -f order-processor-sidecar-l8.yaml
kubectl get deploy order-processor-deploy
kubectl get pods -l app=order-processor,tier=app
```

Wait until **2** Pods show `READY` **2/2**, then **Submit**.

Both containers must share the same Pod template (not two Deployments). Do not use an Init Container for the shipper. Work only in your lab namespace (not `default`).
