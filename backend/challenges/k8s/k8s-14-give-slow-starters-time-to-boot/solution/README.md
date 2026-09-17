# Solution — Give Slow Starters Time to Boot

Stay in your lab namespace. PRE RUN uses **`slow-order-processor:1.0`**: the process listens immediately, but `/health` returns **503 for ~25s**. Existing liveness (`3s` / `3s` / `failureThreshold=3`) kills it mid-warmup → CrashLoopBackOff. Add an HTTP **startup** probe on `/health` so liveness/readiness wait out the warmup. Keep the slow image and the existing live/ready probes.

Docs: [Startup probe](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/#define-startup-probes)

## Optional: confirm the CrashLoop before you fix it

```bash
kubectl get pods -l app=order-processor
kubectl describe pod -l app=order-processor | grep -A4 "Liveness\|Warning\|Last State"
```

## Solution YAML

Save as `order-processor-startup-l14.yaml`:

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
          image: rithvikreddyalkanti/slow-order-processor:1.0
          imagePullPolicy: Always
          ports:
            - containerPort: 8000
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
          startupProbe:
            httpGet:
              path: /health
              port: 8000
            periodSeconds: 5
            failureThreshold: 30
          livenessProbe:
            httpGet:
              path: /health
              port: 8000
            initialDelaySeconds: 3
            periodSeconds: 3
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /health
              port: 8000
            initialDelaySeconds: 3
            periodSeconds: 3
            failureThreshold: 3
```

## Declarative

```bash
kubectl apply -f order-processor-startup-l14.yaml
kubectl rollout status deploy/order-processor-deploy
kubectl get pods -l app=order-processor
```

Warmup still takes ~25s — wait until **2** Pods are Ready without CrashLooping, then **Submit**.

Keep image `slow-order-processor:1.0`. Do not remove liveness or readiness. Work only in your lab namespace (not `default`).
