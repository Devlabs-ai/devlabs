# Solution — Migrate Order Processor

Stay in your lab namespace (kubectl already defaults there). Create Pod `order-processor-pod` with container `order-processor`, image `rithvikreddyalkanti/order-processor:v1.0`, **containerPort 8000**, and resource requests **100m** CPU / **128Mi** memory.

Docs: [Pods](https://kubernetes.io/docs/concepts/workloads/pods/)

## Solution YAML

Save as `order-processor-pod-l1.yaml` (Scratch pad or a file in your lab home):

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: order-processor-pod
spec:
  containers:
    - name: order-processor
      image: rithvikreddyalkanti/order-processor:v1.0
      ports:
        - containerPort: 8000
      resources:
        requests:
          cpu: "100m"
          memory: "128Mi"
```

## Declarative

Apply the manifest, then watch the Pod:

```bash
kubectl apply -f order-processor-pod-l1.yaml
kubectl get pod order-processor-pod -w
```

Wait until `STATUS` is `Running` and `READY` is `1/1`, then **Submit**.

Do not create the Pod in `default`.
