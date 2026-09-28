# Solution — Meet kubectl

A walkthrough of every step in this practice lab. Every command follows the same shape: **`kubectl <verb> <resource> [name] [flags]`**. Your lab namespace is already the default, so you never need `-n`.

Docs: [DevSetu Blog — kubectl: your remote control for the cluster](/play/devops-engineer/kubernetes/read/kubectl-basics) · [kubectl quick reference](https://kubernetes.io/docs/reference/kubectl/quick-reference/)

## 1. Look around

```bash
echo $LEARNER_NS          # the namespace this lab gave you
kubectl get nodes         # the machines in the cluster
kubectl get pods          # Pods in your namespace (mystery-pod, delete-me)
kubectl get pods -o wide  # same list + Pod IP and the node each Pod runs on
```

`get` is the "list" verb: a quick table, one row per object.

## 2. Inspect `mystery-pod`: which image?

```bash
kubectl describe pod mystery-pod
```

`describe` is the "tell me everything" verb: labels, the container image, ports, and the **Events** at the bottom (scheduling, image pull, start). The image line reads `Image: nginx:1.25`.

The same value, straight from the object's YAML:

```bash
kubectl get pod mystery-pod -o yaml               # the full object
kubectl get pod mystery-pod -o jsonpath='{.spec.containers[0].image}'
```

## 3. Read the logs: the secret word

```bash
kubectl logs mystery-pod
```

`logs` prints what the container wrote to stdout. Look for `The secret word is: ...`. Add `-f` to keep following new lines (Ctrl+C to stop).

## 4. Run a command inside the container: the code

```bash
kubectl exec mystery-pod -- cat /tmp/code.txt
```

Everything after `--` runs **inside** the container. For an interactive shell, use `kubectl exec -it mystery-pod -- sh` and type `exit` to leave.

## 5. Create your own Pod, then label it

```bash
kubectl run hello --image=nginx:1.25 --port=80
kubectl get pod hello -w                # watch until READY 1/1, then Ctrl+C
kubectl label pod hello stage=warmup
kubectl get pods --show-labels
kubectl get pods -l stage=warmup        # -l filters by label
```

`kubectl run` is **imperative**: you tell Kubernetes what to do right now, with flags.

## 6. Generate YAML, then apply it

```bash
kubectl run web --image=nginx:1.25 --port=80 --dry-run=client -o yaml > web-pod.yaml
cat web-pod.yaml
kubectl apply -f web-pod.yaml
kubectl get pod web
```

`--dry-run=client -o yaml` prints the object **without creating it**, which is the fastest way to get a correct starting manifest. `kubectl apply -f` is **declarative**: the file is the desired state, and you can edit it and apply again. Every later lab works this way.

## 7. Clean up

```bash
kubectl delete pod delete-me
```

That's it: there's nothing to submit. Keep experimenting, and click **Reset** whenever you want a fresh namespace.

## Cheat sheet

| Want to… | Command |
| --- | --- |
| List things | `kubectl get pods` · `-o wide` · `--show-labels` · `-l key=value` · `-w` |
| See details and events | `kubectl describe pod <name>` |
| See the full object | `kubectl get pod <name> -o yaml` |
| Read output | `kubectl logs <pod>` · `-f` to follow · `--previous` after a crash |
| Run inside a container | `kubectl exec <pod> -- <cmd>` · `-it <pod> -- sh` for a shell |
| Create quickly | `kubectl run` · `kubectl create deployment/configmap/secret ...` |
| Starter YAML | add `--dry-run=client -o yaml > file.yaml` |
| Create or update from a file | `kubectl apply -f file.yaml` |
| Label | `kubectl label pod <name> key=value` |
| Delete | `kubectl delete pod <name>` · `kubectl delete -f file.yaml` |
| Look up a field | `kubectl explain pod.spec.containers` |
