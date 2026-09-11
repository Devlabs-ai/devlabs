# Solution — More Desks Than Hands

Create Deployment `front-desk` with **3** replicas. Selector and pod template must share `app=guestbook` and `tier=frontend`. Use an nginx image and declare **containerPort 80**.

Docs: [Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)

## Declarative

Apply `front-desk-deploy.yaml` from this folder (or the Scratch pad):

```bash
kubectl apply -f front-desk-deploy.yaml
kubectl rollout status deployment/front-desk
kubectl get deploy front-desk
```

Wait until `READY` is `3/3`, then **Submit**.

## Notes

- A bare Pod named `front-desk` from the previous lab is not enough — grade looks for a **Deployment**.
- Selector labels must match the pod template labels exactly.
