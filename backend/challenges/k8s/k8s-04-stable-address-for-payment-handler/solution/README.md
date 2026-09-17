# Solution — Stable Address for Payment Handler

Stay in your lab namespace. Payment Handler Pods are already running with label `app=payment-handler`. Create ClusterIP Service `handler` so Order Processor can dial a stable DNS name instead of a Pod IP.

Docs: [Services](https://kubernetes.io/docs/concepts/services-networking/service/)

## Solution YAML

Save as `payment-handler-svc-l4.yaml` (Scratch pad or a file in your lab home):

```yaml
apiVersion: v1
kind: Service
metadata:
  name: handler
spec:
  type: ClusterIP
  selector:
    app: payment-handler
  ports:
    - port: 8000
      targetPort: 8000
```

## Declarative

Apply the Service, then confirm Endpoints:

```bash
kubectl apply -f payment-handler-svc-l4.yaml
kubectl get svc handler
kubectl get endpoints handler
```

Wait until Endpoints show at least one ready address, then **Submit**.

Do not expose the Service externally (no NodePort / LoadBalancer yet). Work only in your lab namespace (not `default`).
