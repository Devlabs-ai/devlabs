# Solution — Roll Forward with a Deployment

Stay in your lab namespace. Create Deployment `order-processor-deploy` with **3** replicas on image **v1.1** so Order Processor can roll forward without deleting a bare ReplicaSet by hand.

Docs: [Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)

## Solution YAML

Save as `order-processor-deployment-l3.yaml` (Scratch pad or a file in your lab home):

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-processor-deploy
spec:
  replicas: 3
  selector:
    matchLabels:
      app: order-processor
      version: v1.1
  template:
    metadata:
      labels:
        app: order-processor
        version: v1.1
    spec:
      containers:
        - name: order-processor
          image: rithvikreddyalkanti/order-processor:v1.1
          ports:
            - containerPort: 8000
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
```

Selector labels must match the Pod template labels (`app=order-processor`, `version=v1.1`).

## Declarative

Apply the manifest, then check the rollout:

```bash
kubectl apply -f order-processor-deployment-l3.yaml
kubectl get deploy order-processor-deploy
kubectl get pods -l app=order-processor,version=v1.1 -o wide
```

Wait until **3** Pods are `Running` and `READY` is `1/1` each, then **Submit**.

Do not create a bare ReplicaSet — grade looks for a Deployment. Work only in your lab namespace (not `default`).
