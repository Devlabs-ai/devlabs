# Solution — Encrypt Service-to-Service Traffic

Stay in your lab namespace. Turn on mesh sidecar injection and require **STRICT** mTLS for Payment Handler (Order Processor → handler on port 8000).

Docs: [Istio PeerAuthentication](https://istio.io/latest/docs/reference/config/security/peer_authentication/) · [DestinationRule](https://istio.io/latest/docs/reference/config/networking/destination-rule/)

## Solution YAML

Save as `mesh-mtls-l35.yaml` (Istio). Enable injection on the two workloads first by adding the pod-template label `sidecar.istio.io/inject: "true"` (the lab namespace itself is platform-managed, so label the workloads rather than the namespace).

```yaml
apiVersion: security.istio.io/v1
kind: PeerAuthentication
metadata:
  name: payment-handler-strict
spec:
  selector:
    matchLabels:
      app: payment-handler
  mtls:
    mode: STRICT
---
apiVersion: networking.istio.io/v1
kind: DestinationRule
metadata:
  name: payment-handler-mtls
spec:
  host: handler
  trafficPolicy:
    tls:
      mode: ISTIO_MUTUAL
```

If the platform uses Linkerd, use `Server` + `ServerAuthorization` requiring mTLS instead — match the installed mesh.

## Declarative

```bash
for d in order-processor-deploy payment-handler; do
  kubectl patch deploy "$d" --type merge \
    -p '{"spec":{"template":{"metadata":{"labels":{"sidecar.istio.io/inject":"true"}}}}}'
done
kubectl apply -f mesh-mtls-l35.yaml
kubectl rollout status deploy/order-processor-deploy
kubectl rollout status deploy/payment-handler
kubectl get peerauthentication,destinationrule
```

Wait until apps are Ready and the STRICT PeerAuthentication exists, then **Submit**. Do not call Ingress-only TLS “mesh mTLS.”
