# Solution — Ninety Seconds to Green

Imperative-only (no full YAML file):

Docs: [Imperative commands](https://kubernetes.io/docs/reference/kubectl/quick-reference/#creating-objects)

```bash
kubectl create deployment pop-up --image=nginx:1.25 --replicas=2
kubectl label deployment pop-up app=guestbook tier=popup --overwrite
kubectl expose deployment pop-up --name=pop-up --port=80 --target-port=80 --type=ClusterIP
kubectl rollout status deployment/pop-up
kubectl get deploy,svc,endpoints pop-up
```

Wait until the Deployment is **2/2** and the Service lists Endpoints, then **Submit**.
