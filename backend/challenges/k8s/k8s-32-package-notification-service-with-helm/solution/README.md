# Solution — Package Notification Service with Helm

Stay in your lab namespace. Package Notification Service as a Helm chart (Deployment + Service) and install release `notifications`.

Docs: [Helm](https://helm.sh/docs/) · [Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)

## Solution YAML

Chart layout under `charts/notification-service/`:

`Chart.yaml`:

```yaml
apiVersion: v2
name: notification-service
description: QuickByte Notification Service
type: application
version: 0.1.0
appVersion: "1.0"
```

`values.yaml`:

```yaml
replicaCount: 2
image:
  repository: rithvikreddyalkanti/notification-service
  tag: "v1.0"
service:
  port: 8080
```

`templates/deployment.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: notification-service
spec:
  replicas: {{ .Values.replicaCount }}
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
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          ports:
            - containerPort: {{ .Values.service.port }}
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
```

`templates/service.yaml`:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: notification-service
spec:
  type: ClusterIP
  selector:
    app: notification-service
  ports:
    - port: {{ .Values.service.port }}
      targetPort: {{ .Values.service.port }}
```

## Declarative

```bash
helm upgrade --install notifications ./charts/notification-service -n "$LEARNER_NS"
kubectl rollout status deploy/notification-service
kubectl get svc notification-service
```

Wait until Deployment is **2/2** Ready, then **Submit**. Prefer Helm over raw `kubectl apply` unless you use `helm template` then apply as a documented fallback.
