# Solution — Lock Down Payment Handler Process

Stay in your lab namespace. Update Deployment `payment-handler` with a hardened container **securityContext** (non-root, read-only rootfs, drop all capabilities). Mount an emptyDir at `/tmp` if the app needs a writable temp dir.

Docs: [Configure a Security Context](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/)

## Solution YAML

Save as `payment-handler-securitycontext-l15.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-handler
spec:
  replicas: 2
  selector:
    matchLabels:
      app: payment-handler
  template:
    metadata:
      labels:
        app: payment-handler
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        fsGroup: 1000
      containers:
        - name: payment-handler
          image: rithvikreddyalkanti/payment-handler:v1.0
          ports:
            - containerPort: 8000
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
          securityContext:
            runAsNonRoot: true
            runAsUser: 1000
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop:
                - ALL
          volumeMounts:
            - name: tmp
              mountPath: /tmp
      volumes:
        - name: tmp
          emptyDir: {}
```

## Declarative

```bash
kubectl apply -f payment-handler-securitycontext-l15.yaml
kubectl get deploy payment-handler
kubectl get pods -l app=payment-handler
kubectl get deploy payment-handler -o yaml | grep -A12 securityContext
```

Wait until **2** Pods are Ready, then **Submit**.

Do not set `privileged: true`. Work only in your lab namespace (not `default`).
