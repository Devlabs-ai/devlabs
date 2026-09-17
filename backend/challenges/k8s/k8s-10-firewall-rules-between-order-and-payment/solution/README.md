# Solution — Firewall Rules Between Order and Payment

Stay in your lab namespace. Create NetworkPolicy `payment-handler-allow-orders` so only Pods labeled `app=order-processor` may reach Payment Handler on TCP **8000**.

Docs: [NetworkPolicies](https://kubernetes.io/docs/concepts/services-networking/network-policies/)

## Solution YAML

Save as `payment-handler-netpol-l10.yaml`:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: payment-handler-allow-orders
spec:
  podSelector:
    matchLabels:
      app: payment-handler
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: order-processor
      ports:
        - protocol: TCP
          port: 8000
```

## Declarative

```bash
kubectl apply -f payment-handler-netpol-l10.yaml
kubectl get networkpolicy payment-handler-allow-orders
kubectl describe networkpolicy payment-handler-allow-orders
```

Confirm the policy selects `app=payment-handler` and allows ingress from `app=order-processor` on TCP 8000, then **Submit**.

Do not apply a namespace-wide default-deny that breaks DNS. Work only in your lab namespace (not `default`).
