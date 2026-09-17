# Solution — One Front Door for QA and Partners

Stay in your lab namespace. Create Ingress `quickbyte-edge` so `/orders` and `/notify` route to the right ClusterIP Services.

Docs: [Ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/)

## Solution YAML

Save as `quickbyte-ingress-l36.yaml`:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: quickbyte-edge
spec:
  ingressClassName: nginx
  rules:
    - host: qa.quickbyte.lab
      http:
        paths:
          - path: /orders
            pathType: Prefix
            backend:
              service:
                name: order-processor-svc
                port:
                  number: 8000
          - path: /notify
            pathType: Prefix
            backend:
              service:
                name: notification-service
                port:
                  number: 8080
```

Use the platform Ingress class if not `nginx`. Host is optional when the platform does not provide DNS.

## Declarative

```bash
kubectl apply -f quickbyte-ingress-l36.yaml
kubectl get ingress quickbyte-edge
kubectl describe ingress quickbyte-edge
```

Wait until paths are listed (and an address if the controller assigns one), then **Submit**. Do not expose each app with its own LoadBalancer Service for this lab.
