# Solution — Config Without Rebuilding Images

Stay in your lab namespace. Create ConfigMap `order-processor-config` with production settings, then Deploy Order Processor on **v1.2** with those keys injected as environment variables.

Docs: [ConfigMaps](https://kubernetes.io/docs/concepts/configuration/configmap/)

## Solution YAML

Save as `order-processor-config-l6.yaml`:

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

Save as `order-processor-deployment-l6.yaml`:

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
```

You may also inject each key with `env[].valueFrom.configMapKeyRef` instead of `envFrom` — grade accepts either style.

## Declarative

```bash
kubectl apply -f order-processor-config-l6.yaml
kubectl apply -f order-processor-deployment-l6.yaml
kubectl get cm order-processor-config
kubectl get deploy order-processor-deploy
kubectl get pods -l app=order-processor,version=v1.2
```

Wait until **3** Pods are `Running` and `READY` is `1/1` each, then **Submit**.

Work only in your lab namespace (not `default`).
