# Solution — Scale Notifications With Load

Stay in your lab namespace. Attach an HPA so Notification Service scales on CPU between 1 and 5 replicas.

Docs: [HorizontalPodAutoscaler](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/)

## Solution YAML

Save as `notification-hpa-l37.yaml`:

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: notification-service-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: notification-service
  minReplicas: 1
  maxReplicas: 5
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 50
```

The Deployment must already have CPU **requests**. After applying the HPA, leave replica count to the autoscaler.

## Declarative

```bash
kubectl apply -f notification-hpa-l37.yaml
kubectl get hpa notification-service-hpa
kubectl describe hpa notification-service-hpa
```

Confirm targets show CPU 50% and bounds 1–5, then **Submit**. Generating load is optional for grading if the HPA object matches SPEC.
