# Solution — Right-Size Payment Handler Resources

Stay in your lab namespace. Create a VerticalPodAutoscaler for Payment Handler in **Off** (recommend-only) mode.

Docs: [Vertical Pod Autoscaler](https://github.com/kubernetes/autoscaler/tree/master/vertical-pod-autoscaler)

## Solution YAML

Save as `payment-handler-vpa-l38.yaml`:

```yaml
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata:
  name: payment-handler-vpa
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: payment-handler
  updatePolicy:
    updateMode: "Off"
```

## Declarative

```bash
kubectl apply -f payment-handler-vpa-l38.yaml
kubectl describe vpa payment-handler-vpa
```

Confirm `updateMode: Off` and that recommendations appear when the VPA recommender has samples, then **Submit**. Do not combine VPA auto-update with HPA on the same metrics in this lab.
