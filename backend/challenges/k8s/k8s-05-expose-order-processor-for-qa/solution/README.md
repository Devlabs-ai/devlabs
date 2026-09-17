# Solution — Expose Order Processor for QA

Stay in your lab namespace. Order Processor Pods (labels `app=order-processor`, `version=v1.1`) should already be running. Create NodePort Service `order-processor-svc` on node port **30080** so QA *can* reach the app via `NodeIP:30080` when the network allows it (no laptop holding `port-forward` for them).

Docs: [Service NodePort](https://kubernetes.io/docs/concepts/services-networking/service/#type-nodeport)

## Solution YAML

Save as `order-processor-svc-l5.yaml` (Scratch pad or a file in your lab home):

```yaml
apiVersion: v1
kind: Service
metadata:
  name: order-processor-svc
spec:
  type: NodePort
  selector:
    app: order-processor
    version: v1.1
  ports:
    - port: 8000
      targetPort: 8000
      nodePort: 30080
```

## Declarative

Apply the Service, then confirm type, node port, and Endpoints:

```bash
kubectl apply -f order-processor-svc-l5.yaml
kubectl get svc order-processor-svc
kubectl get endpoints order-processor-svc
```

You should see `TYPE=NodePort`, `8000:30080/TCP`, and at least one ready Endpoint address.

Optional smoke-test from the lab terminal (NodeIP curls often time out here — use port-forward instead):

```bash
kubectl port-forward svc/order-processor-svc 8000:8000
# in another shell: curl -sS http://127.0.0.1:8000/health
```

Then **Submit**. Do not use `LoadBalancer`. Work only in your lab namespace (not `default`).
