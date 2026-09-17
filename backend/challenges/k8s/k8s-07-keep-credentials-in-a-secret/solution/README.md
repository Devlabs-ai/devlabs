# Solution — Keep Credentials in a Secret

Stay in your lab namespace. Put non-secret settings in a ConfigMap and the payment gateway API key in a Secret, then Deploy Order Processor **v1.2** wired to both.

Docs: [Secrets](https://kubernetes.io/docs/concepts/configuration/secret/)

## Solution YAML

Save as `order-processor-config-l7.yaml`:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: order-processor-config
data:
  MIN_ORDER_VALUE: "50"
  MAX_ITEMS_PER_ORDER: "20"
  LOG_LEVEL: "INFO"
```

Save as `order-processor-secret-l7.yaml`:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: order-processor-secrets
type: Opaque
data:
  PAYMENT_API_KEY: cWItbGl2ZS1nYXRld2F5LWtleS0yMDI2
```

Save as `order-processor-deployment-l7.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-processor-deploy
spec:
  replicas: 3
  selector:
    matchLabels:
      app: order-processor
      version: v1.2
  template:
    metadata:
      labels:
        app: order-processor
        version: v1.2
    spec:
      containers:
        - name: order-processor
          image: rithvikreddyalkanti/order-processor:v1.2
          ports:
            - containerPort: 8000
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
          envFrom:
            - configMapRef:
                name: order-processor-config
          env:
            - name: PAYMENT_API_KEY
              valueFrom:
                secretKeyRef:
                  name: order-processor-secrets
                  key: PAYMENT_API_KEY
```

Do **not** put `PAYMENT_API_KEY` in the ConfigMap.

## Declarative

```bash
kubectl apply -f order-processor-config-l7.yaml
kubectl apply -f order-processor-secret-l7.yaml
kubectl apply -f order-processor-deployment-l7.yaml
kubectl get cm order-processor-config
kubectl get secret order-processor-secrets
kubectl get deploy order-processor-deploy
kubectl get pods -l app=order-processor,version=v1.2
```

Wait until **3** Pods are `Running` and `READY` is `1/1` each, then **Submit**.

Work only in your lab namespace (not `default`).
