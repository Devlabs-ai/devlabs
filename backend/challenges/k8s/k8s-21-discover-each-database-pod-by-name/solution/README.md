# Solution — Discover Each Database Pod by Name

Create a headless Service `orders-db` (`clusterIP: None`) so each StatefulSet Pod gets a stable DNS name.

Docs: [Headless Services](https://kubernetes.io/docs/concepts/services-networking/service/#headless-services)

## Solution YAML

Save as `orders-db-headless-l21.yaml`:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: orders-db
spec:
  clusterIP: None
  selector:
    app: orders-db
  ports:
    - name: postgres
      port: 5432
      targetPort: 5432
```

## Declarative

```bash
kubectl apply -f orders-db-headless-l21.yaml
kubectl get svc orders-db
kubectl get endpoints orders-db
```

Confirm `CLUSTER-IP` is **None** and both Pods appear as backends, then **Submit**.
