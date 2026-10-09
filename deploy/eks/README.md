# DevSetu EKS ops (Lean Beta)

Scripts to **sleep / wake** the lab cluster without losing IAM wiring, and to
**destroy / recreate** the control plane when you want to stop the ~\$73/mo EKS fee.

Defaults match the live `devlabs` cluster in **ap-south-2** (see `env.sh`).

| Script | What it does | Control plane bill |
|--------|----------------|--------------------|
| `eks-sleep.sh` | All node groups → Desired **0** | Still pays |
| `eks-wake.sh` | `system-k8s` → **1**, `labs-k8s` → **2** (base) | Still pays |
| `eks-status.sh` | Print cluster / NG / access / addons | — |
| `eks-access.sh` | Access Entry + `DevLabsEksDescribe` for app user | — |
| `eks-addon-placement.sh` | Pin add-on Deployments to `system-k8s` nodes | — |
| `eks-karpenter.sh` | Karpenter IAM + controller + `labs-elastic` NodePool (`EKS_KARPENTER_LABS_POOL=0`: controller only, for a cluster without `labs-k8s`) | — |
| `eks-kyverno.sh` | Kyverno + learner `do-not-disrupt` policy | — |
| `eks-admission.sh` | Policies that keep learner workloads inside lab quota / limits | — |
| `eks-labs-sleep.sh` | Park k8s-lab capacity: balloons → 0, `labs-elastic` nodes removed, `labs-k8s` → **0** | Still pays |
| `eks-linux.sh` | Linux-module capacity: `base` (managed node group `labs-linux`, always-on, admin creds), `up` (Karpenter `labs-linux-elastic` overflow + `nri-cgroup-rw` plugin for systemd in user-namespaced pods + box seccomp profiles), `seccomp` (profiles only), `sleep` / `wake`, `spike` / `check` / `down` | — |
| `eks-nodegroup-update.sh` | Roll learner node groups onto the current launch template and latest AMI (evicts their pods) | — |
| `eks-docker.sh` | Docker-module capacity, same subcommands as `eks-linux.sh`: managed node group `labs-docker` (t4g.medium), Karpenter `labs-docker-elastic`, `nri-cgroup-rw-docker`, and the Docker Hub pull-through mirror `dl-mirror/registry-mirror` (`docker/registry-mirror.yaml`) | — |
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
./deploy/eks/eks-wake.sh           # system-k8s → 1, labs-k8s → 2
```

Wake only one pool:

```bash
EKS_WAKE_NODEGROUPS=labs-k8s ./deploy/eks/eks-wake.sh
```

---

## Node groups

| Group | Instance | Arch / AMI | Base | Runs |
|-------|----------|------------|------|------|
| `system-k8s` | `t4g.medium` | arm64 / `AL2023_ARM_64_STANDARD` | 1 | Add-ons, platform |
| `labs-k8s` | `t4g.medium` | arm64 / `AL2023_ARM_64_STANDARD` | 1 | Learner workloads |

`system-k8s` carries the taint `CriticalAddonsOnly=true:NoSchedule`, so learner
pods (which never set tolerations) only schedule on `labs-k8s`. EKS add-ons and
all kube-system DaemonSets already tolerate it. Anything platform-owned you add
later (e.g. Karpenter) needs that toleration to run on system nodes.

The add-on Deployments (CoreDNS, metrics-server, snapshot-controller, EBS CSI
controller) are pinned to `devlabs.io/pool=system` through each add-on's
configuration values, so they never take learner capacity. After a fresh
`eks-recreate.sh`, wake a system node first, then run `./deploy/eks/eks-addon-placement.sh`
(otherwise they sit Pending and cluster DNS is down). The setting survives sleep/wake.

Learner nodes are **Graviton only**. Every image a lab pulls must have an arm64
build: `devsetu/*` images are published multi-arch by `./images/build-all.sh`;
third-party images (`nginx`, `busybox`, `postgres`, `bitnami/kubectl`) already are.
When adding a new lab image, check with `docker buildx imagetools inspect <image>`.

**Network policy:** the VPC CNI add-on runs its network policy agent (`enableNetworkPolicy` in
`EKS_VPC_CNI_CONFIG`), so NetworkPolicies are enforced: `dl-box-isolation` in every `lx-*` /
`dk-*` namespace, and learners' own policies in `ns-*`. Re-running `eks-recreate.sh` applies the
config to an existing cluster.

**Pod density:** the VPC CNI runs with **prefix delegation** (`ENABLE_PREFIX_DELEGATION=true`,
`MINIMUM_IP_TARGET=80`, `WARM_IP_TARGET=16`), so pod count is no longer capped by the ENI IP formula
(17 on `t4g.medium`). Learner nodes run **42 pods** (38 learner slots of 40m / 64Mi after
4 DaemonSets). 80 IPs (5 prefixes) per node cover 42 pods plus the IPs of just-deleted pods, which
the CNI won't reuse for 30 s: replacing 28 pods at once starts in ~8 s instead of ~41 s.

- All learner launch templates (`nodegroups.sh`) and Karpenter `EC2NodeClass`es also set
  **IMDS hop limit 1** (learner pods can't reach the node role's credentials) and a boot script
  with **`kernel.io_uring_disabled=2`**. Template changes are detected by a checksum in the
  version description; roll existing groups with `./deploy/eks/eks-nodegroup-update.sh <group>`.
  See `docs/security/linux-lab-hardening-2026-10-06.md`.
- `labs-k8s` — launch template `devlabs-labs-k8s` (created by `eks-recreate.sh`) with a
  `nodeadm` NodeConfig: `maxPods: 42`, explicit `kubeReserved` (70m / 717Mi / 1Gi), 25 GiB gp3.
- Karpenter — `kubelet.maxPods` / `kubeReserved` in `karpenter/nodepool.yaml`.
- `labs-linux` — launch template `devlabs-labs-linux` (`nodegroups.sh`): `maxPods: 50`,
  `podPidsLimit: 512`, `kubeReserved` 70m / 805Mi / 1Gi, 30 GiB gp3, label
  `devlabs.io/pool=linux,devlabs.io/tier=base`, taint `devlabs.io/pool=linux:NoSchedule`.
  Its Karpenter overflow `labs-linux-elastic` (`karpenter/nodepool-linux.yaml`) must match
  (`EKS_LINUX_*` in `env.sh`).
- `labs-docker` — launch template `devlabs-labs-docker` (`nodegroups.sh`): t4g.medium,
  `maxPods: 17`, `podPidsLimit: 1024`, `kubeReserved` 70m / 442Mi / 1Gi, 100 GiB gp3 (image
  layers live on the node disk), label `devlabs.io/pool=docker,devlabs.io/tier=base`, taint
  `devlabs.io/pool=docker:NoSchedule`. Overflow `labs-docker-elastic`
  (`karpenter/nodepool-docker.yaml`) must match (`EKS_DOCKER_*` in `env.sh`). Not in
  `EKS_NODEGROUPS` yet, so `eks-sleep.sh` skips it: park it with `eks-docker.sh sleep`.

Change density via `EKS_LABS_MAX_PODS` (reserve = `11 × maxPods + 255` Mi) **and** the
NodeClass. Existing node groups pick up a new launch template version only with
`aws eks update-nodegroup-version --launch-template name=devlabs-labs-k8s,version=<n>`.
Check: `kubectl get nodes -o custom-columns=NODE:.metadata.name,PODS:.status.allocatable.pods,MEM:.status.allocatable.memory`.

Switch the labs instance size with `EKS_LABS_INSTANCE_TYPE` in `env.sh` (must stay
a Graviton type — `t4g.*`, `m7g.*`, …). Managed node groups can't change instance
type in place: create a new group, drain the old one, then delete it.

---

## Elastic learner capacity (Karpenter)

`labs-k8s` is the always-on base. When learner pods don't fit, Karpenter
(`eks-karpenter.sh`, controller on `system-k8s`) adds `t4g.medium`
nodes from NodePool `labs-elastic` (`karpenter/nodepool.yaml`, 8 vCPU cap) and
removes them once they're no longer needed.

The NodePool uses `consolidationPolicy: WhenEmptyOrUnderutilized`, which on its own
**evicts live pods** to repack nodes. Learner pods are protected by
`kyverno/learner-do-not-disrupt.yaml`, which adds `karpenter.sh/do-not-disrupt: "true"`
to every Pod created in an `ns-*` namespace. Karpenter never evicts those pods and
never removes a node running one. Their nodes go away only after the lab ends and
the node is empty (~3 min). Unannotated pods (e.g. balloons) are still repacked.

**Warm headroom:** `karpenter/balloons.yaml` keeps 10 balloon pods (`dl-system/dl-balloon`,
priority -10, 40m / 64Mi each = one learner slot) anywhere in the learner pool, so they sit on the
base when it has room and no extra node idles. Learners take free slots first and preempt balloons
only when a node is otherwise full. The evicted balloon goes Pending and Karpenter buys the next
node in the background. Consolidation later packs the balloons back and removes the spare node.

**Reserved slots per open lab:** a second Deployment, `dl-system/dl-balloon-reserved`
(priority -5, so warm balloons are evicted first), is scaled by the backend
(`backend/workspace/k8sCapacity.ts`, every 3 s). For each active lab it holds
`reservePods − pods the lab is running` slots (`reservePods` defaults to quota pods − 3, i.e. the
workload pods; `slotsPerPod` in the pack scales it for bigger pods). The learner's workload pods
therefore always start instantly; only the 3 headroom pods may wait for a new node (~30–40 s).
When that happens the backend emits a `DevSetuCapacity` Event in the learner's namespace and the
lab shows a banner (`GET /api/session/k8s/capacity`). On lab open, setup waits until every
reserved balloon has a node (or enough warm balloons are running to absorb the rest), so a new
lab can't take another lab's reserved slots. The terminal then stays on "Preparing…" until the
setup pods are scheduled (90 s cap each). Re-applying `balloons.yaml` resets the reserved count to
0 until the next reconcile (≤ ~12 s).

Only one backend per cluster may scale the reserved balloons: `K8S_CAPACITY_MANAGER=1` is set in
`docker-compose.prod.yml`. Leave it unset on laptops pointing at the same cluster; a second
manager sees none of the first one's labs and scales their reservations to 0.
Keep the balloons' `terminationGracePeriodSeconds` above 0 (see the comment in the file):
at 0, a Kubernetes scheduler bug can leave learner pods Pending for 5 minutes.

The policy is a Kyverno `MutatingPolicy` compiled to a native
`MutatingAdmissionPolicy`, so the API server applies it even while the Kyverno pod
is down. Install order after a recreate: `eks-addon-placement.sh` → `eks-karpenter.sh` → `eks-kyverno.sh`.

```bash
kubectl get mutatingadmissionpolicy mpol-learner-pods-do-not-disrupt
kubectl get events -A --field-selector reason=DisruptionBlocked   # "Pod has karpenter.sh/do-not-disrupt"
```

---

## Learner quotas and admission policies

On lab open the backend writes two objects into the learner namespace
(`backend/workspace/k8sCluster.ts`), sized per pack from `platformSpec.quota`:

- ResourceQuota `dl-lab-quota` — `pods`, `requests.*` and `limits.*` (pack quota =
  workload pods + 3 headroom; each default container adds 20m/32Mi requests, 40m/64Mi limits).
- LimitRange `dl-lab-limits` — per container: default request 20m / 32Mi, default limit
  40m / 64Mi, max 100m / 128Mi. Lab 11 overrides it (it teaches limits).

Learners can read both but not change them. Those two objects only check Pods, so a Deployment
that could never fit is accepted and then fails every pod silently (`FailedCreate`). The
native ValidatingAdmissionPolicies in `admission/learner-resource-policies.yaml`
(`eks-admission.sh`) reject such objects at apply time, with the lab's own numbers in the
message:

| Policy | Rejects |
|--------|---------|
| `dl-learner-replicas-within-quota` | Deployment / StatefulSet / ReplicaSet / RC `replicas` (and `kubectl scale`) above quota `pods` |
| `dl-learner-hpa-within-quota` | HPA `maxReplicas` above quota `pods` |
| `dl-learner-template-resources` | pod templates (Deployment, StatefulSet, ReplicaSet, DaemonSet, Job) with a container over the LimitRange max, or requests above the limit (explicit or LimitRange default) |
| `dl-learner-cronjob-resources` | the same check for CronJob templates |

The policies read the namespace's own `dl-lab-quota` / `dl-lab-limits` as parameters, so
namespaces without them (everything that isn't `ns-*`) are skipped. They evaluate only when
replicas or the template change, so deletes and label edits on older objects still work.

```bash
kubectl get validatingadmissionpolicies | rg dl-learner
kubectl -n ns-<user> describe resourcequota dl-lab-quota
```

---

## Hibernate weeks+ (stop control plane)

```bash
./deploy/eks/eks-destroy.sh        # confirm by typing: devlabs
# …later…
./deploy/eks/eks-recreate.sh       # cluster, node groups (Desired=0), add-ons, prefix delegation, LT
./deploy/eks/eks-wake.sh
./deploy/eks/eks-addon-placement.sh   # once a system-k8s node is Ready
./deploy/eks/eks-karpenter.sh         # Karpenter + NodePool + balloons
./deploy/eks/eks-kyverno.sh           # learner do-not-disrupt
./deploy/eks/eks-admission.sh         # learner quota / LimitRange policies
# then push the new kubeconfig to the App EC2 (see below)
```

`eks-destroy.sh` first deletes the balloons, the NodePools (Karpenter terminates its own
nodes) and the Karpenter controller, then terminates any leftover Karpenter-tagged
instances. Karpenter nodes live outside the node groups, so without this step the cluster
delete would leave them running and billing.

Kept across destroy (reused on recreate): the `devlabs-labs-k8s` launch template, the
`Karpenter-devlabs` CloudFormation stack (IAM roles, interruption queue), the Karpenter
controller role, and the subnet discovery tags. None of them costs anything while idle.

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
