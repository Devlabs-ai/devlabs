# Solution — Roll Forward and Undo Order Processor

Stay in your lab namespace. Set RollingUpdate surge settings, roll Order Processor to `v1.2`, then **undo** to the previous revision (`v1.1`).

Docs: [Deployments — rolling update](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/#rolling-update-deployment) · [rollout undo](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_rollout/kubectl_rollout_undo/)

## Solution YAML

Save as `order-processor-rollout-l40.yaml` (forward change before undo):

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-processor-deploy
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
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
          image: rithvikreddyalkanti/order-processor:v1.2
          ports:
            - containerPort: 8000
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
```

## Declarative

```bash
kubectl apply -f order-processor-rollout-l40.yaml
kubectl rollout status deploy/order-processor-deploy
kubectl set image deploy/order-processor-deploy order-processor=rithvikreddyalkanti/order-processor:v1.2  # if already applied via YAML
kubectl rollout undo deploy/order-processor-deploy
kubectl rollout status deploy/order-processor-deploy
kubectl get deploy order-processor-deploy -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'
```

Final image must be `rithvikreddyalkanti/order-processor:v1.1` with **3/3** Ready. Do not delete the Deployment to “fix” the version.
