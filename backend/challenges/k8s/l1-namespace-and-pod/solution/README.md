# Solution — Open the Front Desk

Stay in your lab namespace (kubectl already defaults there). Create Pod `front-desk` with Guestbook frontend labels, an nginx image, and **containerPort 80**.

Docs: [Pods](https://kubernetes.io/docs/concepts/workloads/pods/)

## Imperative

```bash
kubectl run front-desk --image=nginx:1.25 --port=80 -l app=guestbook,tier=frontend
kubectl get pod front-desk
```

Wait until `STATUS` is `Running`, then **Submit**.

## Declarative

Apply `front-desk.yaml` from this folder (or the Scratch pad):

```bash
kubectl apply -f front-desk.yaml
kubectl get pod front-desk -w
```

Do not create the Pod in `default`.
