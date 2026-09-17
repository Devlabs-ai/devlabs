# Solution — Only Payments on Tainted PCI Nodes

Add a toleration on `payment-handler` for taint `pci=true:NoSchedule`. Do not add that toleration to Notification Service.

Docs: [Taints and Tolerations](https://kubernetes.io/docs/concepts/scheduling-eviction/taint-and-toleration/)

## Solution YAML

Save as `payment-toleration-l29.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-handler
spec:
  replicas: 2
  selector:
    matchLabels:
      app: payment-handler
  template:
    metadata:
      labels:
        app: payment-handler
    spec:
      tolerations:
        - key: pci
          operator: Equal
          value: "true"
          effect: NoSchedule
      containers:
        - name: payment-handler
          image: rithvikreddyalkanti/payment-handler:v1.0
          ports:
            - containerPort: 8000
```

## Declarative

```bash
kubectl apply -f payment-toleration-l29.yaml
kubectl get deploy payment-handler -o yaml | grep -A10 tolerations
kubectl get pods -l app=payment-handler -o wide
```

Wait until **2/2** Payment Pods are Ready, then **Submit**.
