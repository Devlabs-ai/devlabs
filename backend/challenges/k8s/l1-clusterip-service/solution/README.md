# Solution — The Inside Line

Deployment `front-desk` is already running. Create a **ClusterIP** Service with the same name, selector `app=guestbook` + `tier=frontend`, and **port 80 / targetPort 80**.

Docs: [Services](https://kubernetes.io/docs/concepts/services-networking/service/)

## Imperative

```bash
kubectl expose deployment front-desk --name=front-desk --port=80 --target-port=80 --type=ClusterIP
kubectl get svc,endpoints front-desk
```

## Declarative

Apply `front-desk-svc.yaml` from this folder (or the Scratch pad):

```bash
kubectl apply -f front-desk-svc.yaml
kubectl get svc,endpoints front-desk
```

Confirm Endpoints list pod IPs, then **Submit**.
