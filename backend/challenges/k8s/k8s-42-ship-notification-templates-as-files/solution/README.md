# Solution — Ship Notification Templates as Files

Stay in your lab namespace. Create ConfigMap `notification-templates` and mount it as files at `/etc/notification/templates` on Notification Service.

Docs: [ConfigMap as files](https://kubernetes.io/docs/concepts/configuration/configmap/#using-configmaps-as-files-from-a-pod)

## Solution YAML

Save as `notification-templates-l42.yaml`:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: notification-templates
data:
  order-confirm.txt: "Your QuickByte order is confirmed."
  payment-ok.txt: "Payment received. Thank you."
```

Save as `notification-templates-deploy-l42.yaml` (Deployment update):

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
          volumeMounts:
            - name: templates
              mountPath: /etc/notification/templates
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
      volumes:
        - name: templates
          configMap:
            name: notification-templates
```

## Declarative

```bash
kubectl apply -f notification-templates-l42.yaml
kubectl apply -f notification-templates-deploy-l42.yaml
kubectl rollout status deploy/notification-service
POD=$(kubectl -n "$LEARNER_NS" get pod -l app=notification-service -o jsonpath='{.items[0].metadata.name}')
kubectl exec "$POD" -- ls /etc/notification/templates
```

Confirm both template files exist in the mount and Deployment is **2/2** Ready, then **Submit**. Mount as a volume — not only `env` / `envFrom`.
