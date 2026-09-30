# DevSetu EKS ops (Lean Beta)

Scripts to **sleep / wake** the lab cluster without losing IAM wiring, and to
**destroy / recreate** the control plane when you want to stop the ~\$73/mo EKS fee.

Defaults match the live `devlabs` cluster in **ap-south-2** (see `env.sh`).

| Script | What it does | Control plane bill |
|--------|----------------|--------------------|
| `eks-sleep.sh` | All node groups → Desired **0** | Still pays |
| `eks-wake.sh` | Default `system-k8s` → Desired **1** | Still pays |
| `eks-status.sh` | Print cluster / NG / access / addons | — |
| `eks-access.sh` | Access Entry + `DevLabsEksDescribe` for app user | — |
| `eks-kubeconfig.sh` | Refresh `kube/k8s-lab.kubeconfig` | — |
| `eks-recreate.sh` | Create cluster+NGs if missing, access, kubeconfig | Starts paying |
| `eks-destroy.sh` | Delete NGs + cluster | Stops paying |

Also checked in:

- `cluster.yaml` — optional **eksctl** ClusterConfig (same shape)
- `iam/*.json` — policy documents for `devlabs-app-s3`

Learner progress lives on the **App EC2** (`/opt/devlabs/kube/homes`), not in EKS.
Destroying the cluster does **not** delete those snapshots.

---

## Day-to-day (keep cluster, stop node spend)

```bash
# from laptop with AWS admin creds
./deploy/eks/eks-status.sh
./deploy/eks/eks-sleep.sh          # nodes → 0
./deploy/eks/eks-wake.sh           # system-k8s → 1 when you need labs
```

Wake both pools:

```bash
EKS_WAKE_NODEGROUPS=system-k8s,workload-v2 ./deploy/eks/eks-wake.sh
```

---

## Hibernate weeks+ (stop control plane)

```bash
./deploy/eks/eks-destroy.sh        # confirm by typing: devlabs
# …later…
./deploy/eks/eks-recreate.sh       # nodes start at Desired=0
./deploy/eks/eks-wake.sh
# on EC2: ensure kubeconfig path + restart backend
EKS_KUBECONFIG_OUT=/opt/devlabs/kube/k8s-lab.kubeconfig ./deploy/eks/eks-kubeconfig.sh
```

`eks-recreate.sh` reuses existing IAM roles:

- `AmazonEKSClusterRole`
- `AmazonEKSNodeRole`
- `AmazonEKSPodIdentityAmazonEBSCSIDriverRole` (Pod Identity for `aws-ebs-csi-driver`)
- user `devlabs-app-s3` + Access Entry `AmazonEKSClusterAdminPolicy`

Without the EBS CSI Pod Identity association, `ebs-csi-controller` CrashLoops (`no EC2 IMDS role found`).

---

## After recreate → App EC2 kubeconfig (from Mac)

The EC2 login shell has **no AWS credentials** (keys live in `/opt/devlabs/.env` for
Docker). Refresh kubeconfig on your Mac and push it:

```bash
# sync app + refresh remote kubeconfig + recreate backend
EC2_HOST=18.61.188.116 EC2_KEY=./.devlabs-beta.pem \
  ./scripts/sync-to-ec2.sh --with-kubeconfig

# kubeconfig-only later (after eks-recreate / endpoint change)
EC2_HOST=18.61.188.116 EC2_KEY=./.devlabs-beta.pem \
  ./scripts/refresh-ec2-kubeconfig.sh
```

`refresh-ec2-kubeconfig.sh` writes `kube/k8s-lab.kubeconfig` locally, scp's it to
`/opt/devlabs/kube/k8s-lab.kubeconfig`, and force-recreates the backend (clears the
process-cached API server URL). Use `--no-recreate` to skip the compose step.

---

## Requirements

- AWS CLI v2 with rights to EKS + IAM (for recreate/destroy/access)
- `kubectl` for kubeconfig smoke test
- `jq` only if you extend scripts (recreate uses bash arrays; jq optional for future)

Do **not** commit real kubeconfig secrets; `kube/*.kubeconfig` stays gitignored.
