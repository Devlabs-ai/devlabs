# Solution — Restart Dead Order Processor Pods

Stay in your lab namespace. PRE RUN uses image **`zombie-order-processor:1.0`**: the container is Running, but `GET /health` **hangs** until Kubernetes restarts it. Add an HTTP **liveness** probe on `/health`. Leave the rest of the seeded pod template as-is (including any mounts already present — lab plumbing, not part of this lesson).

Docs: [Liveness probe](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)

## Optional: see the hang before you fix it

```bash
POD=$(kubectl get pod -l app=order-processor -o jsonpath='{.items[0].metadata.name}')
kubectl exec -it "$POD" -c order-processor -- \
  python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)"
```

## Solution YAML

Save as `order-processor-liveness-l12.yaml` (full Deployment so apply replaces cleanly — keep seeded mounts):

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
      volumes:
        - name: zombie-mark
          emptyDir: {}
      containers:
        - name: order-processor
          image: rithvikreddyalkanti/zombie-order-processor:1.0
          ports:
            - containerPort: 8000
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
          volumeMounts:
            - name: zombie-mark
              mountPath: /var/run/zombie
          livenessProbe:
            httpGet:
              path: /health
              port: 8000
            initialDelaySeconds: 10
            periodSeconds: 10
            failureThreshold: 3
```

## Declarative

```bash
kubectl apply -f order-processor-liveness-l12.yaml
kubectl rollout status deploy/order-processor-deploy
kubectl get pods -l app=order-processor
```

Wait until Pods show **Ready** and **RESTARTS ≥ 1**, then **Submit**.

After revive:

```bash
POD=$(kubectl get pod -l app=order-processor -o jsonpath='{.items[0].metadata.name}')
kubectl exec -it "$POD" -c order-processor -- \
  python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3).read().decode())"
```

Keep image `zombie-order-processor:1.0`. Work only in your lab namespace (not `default`).
