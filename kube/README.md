# Place k8s-lab.kubeconfig here on the EC2 host (do not commit secrets).

Learner lab homes and challenge snapshots live under `homes/` (compose mounts
`./kube/homes` → container `/home`). Create on the host if missing:

```bash
mkdir -p /opt/devlabs/kube/homes
```

## EKS sleep / wake / recreate

See [`deploy/eks/README.md`](../deploy/eks/README.md):

```bash
./deploy/eks/eks-sleep.sh    # nodes → 0 (keep control plane)
./deploy/eks/eks-wake.sh     # system-k8s → 1
./deploy/eks/eks-destroy.sh  # delete cluster (stop ~$73/mo)
./deploy/eks/eks-recreate.sh # recreate + access + kubeconfig
```

Do not commit `homes/` or `*.kubeconfig`.
