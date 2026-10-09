# Shared defaults for DevSetu EKS ops (ap-south-2 / cluster devlabs).
# Override any value via environment before calling the scripts.

export AWS_REGION="${AWS_REGION:-ap-south-2}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-$AWS_REGION}"

export EKS_CLUSTER_NAME="${EKS_CLUSTER_NAME:-devlabs}"
export EKS_VERSION="${EKS_VERSION:-1.36}"

export EKS_VPC_ID="${EKS_VPC_ID:-vpc-0ea19acfd53ef3bdf}"
export EKS_SUBNET_IDS="${EKS_SUBNET_IDS:-subnet-09dd7f7d88b80ce1e,subnet-0aa47c67af1a96192,subnet-081dce215dedd106f}"

export EKS_CLUSTER_ROLE_ARN="${EKS_CLUSTER_ROLE_ARN:-arn:aws:iam::204098850303:role/AmazonEKSClusterRole}"
export EKS_NODE_ROLE_ARN="${EKS_NODE_ROLE_ARN:-arn:aws:iam::204098850303:role/AmazonEKSNodeRole}"
# Pod Identity role for aws-ebs-csi-driver (AmazonEBSCSIDriverPolicyV2)
export EKS_EBS_CSI_ROLE_ARN="${EKS_EBS_CSI_ROLE_ARN:-arn:aws:iam::204098850303:role/AmazonEKSPodIdentityAmazonEBSCSIDriverRole}"
export EKS_EBS_CSI_NAMESPACE="${EKS_EBS_CSI_NAMESPACE:-kube-system}"
export EKS_EBS_CSI_SA="${EKS_EBS_CSI_SA:-ebs-csi-controller-sa}"

# App IAM user used by the backend for S3 + aws eks get-token
export EKS_APP_USER_ARN="${EKS_APP_USER_ARN:-arn:aws:iam::204098850303:user/devlabs-app-s3}"
export EKS_APP_USER_NAME="${EKS_APP_USER_NAME:-devlabs-app-s3}"

# Comma-separated managed node groups (both Graviton / arm64)
#   system-k8s — add-ons / platform; tainted so learner pods stay off
#   labs-k8s   — learner workloads, always-on base (lab images are multi-arch)
#   labs-linux — Linux-module learner machines (boxes), always-on base; tainted so only boxes land
export EKS_NODEGROUPS="${EKS_NODEGROUPS:-system-k8s,labs-k8s,labs-linux}"
# Which groups to wake by default
export EKS_WAKE_NODEGROUPS="${EKS_WAKE_NODEGROUPS:-system-k8s,labs-k8s,labs-linux}"
# Overrides every group's desired/min/max when set (otherwise per-group values below)
export EKS_WAKE_DESIRED="${EKS_WAKE_DESIRED:-}"
export EKS_WAKE_MIN="${EKS_WAKE_MIN:-}"
export EKS_WAKE_MAX="${EKS_WAKE_MAX:-}"

export EKS_SYSTEM_INSTANCE_TYPE="${EKS_SYSTEM_INSTANCE_TYPE:-t4g.medium}"
export EKS_SYSTEM_AMI_TYPE="${EKS_SYSTEM_AMI_TYPE:-AL2023_ARM_64_STANDARD}"
export EKS_SYSTEM_DESIRED="${EKS_SYSTEM_DESIRED:-1}"
export EKS_SYSTEM_MAX="${EKS_SYSTEM_MAX:-2}"

# One always-on base node; Karpenter adds the rest (same type, karpenter/nodepool.yaml).
# Must stay an arm64 / Graviton type.
export EKS_LABS_INSTANCE_TYPE="${EKS_LABS_INSTANCE_TYPE:-t4g.medium}"
export EKS_LABS_AMI_TYPE="${EKS_LABS_AMI_TYPE:-AL2023_ARM_64_STANDARD}"
export EKS_LABS_DESIRED="${EKS_LABS_DESIRED:-1}"
export EKS_LABS_MAX="${EKS_LABS_MAX:-1}"
# Learner node density (VPC CNI prefix delegation). Keep in sync with
# karpenter/nodepool.yaml. kube-reserved memory = 11 × maxPods + 255 Mi.
# 42 pods on t4g.medium = 4 DaemonSets + 38 learner slots (each 40m / 64Mi at limit).
export EKS_LABS_MAX_PODS="${EKS_LABS_MAX_PODS:-42}"
export EKS_LABS_KUBE_RESERVED_MEMORY="${EKS_LABS_KUBE_RESERVED_MEMORY:-$(( 11 * EKS_LABS_MAX_PODS + 255 ))Mi}"
export EKS_LABS_LAUNCH_TEMPLATE="${EKS_LABS_LAUNCH_TEMPLATE:-${EKS_CLUSTER_NAME:-devlabs}-labs-k8s}"

# One always-on base node for Linux boxes; Karpenter adds the rest (labs-linux-elastic,
# karpenter/nodepool-linux.yaml). Keep maxPods / kubeReserved / podPidsLimit / disk in sync
# with that EC2NodeClass. 50 pods on t4g.medium = 5 DaemonSets (incl. NRI) + ~43 boxes,
# capped by memory requests (backend/workspace/linuxBox.ts).
export EKS_LINUX_INSTANCE_TYPE="${EKS_LINUX_INSTANCE_TYPE:-t4g.medium}"
export EKS_LINUX_AMI_TYPE="${EKS_LINUX_AMI_TYPE:-AL2023_ARM_64_STANDARD}"
export EKS_LINUX_DESIRED="${EKS_LINUX_DESIRED:-1}"
export EKS_LINUX_MAX="${EKS_LINUX_MAX:-1}"
export EKS_LINUX_MAX_PODS="${EKS_LINUX_MAX_PODS:-50}"
export EKS_LINUX_KUBE_RESERVED_MEMORY="${EKS_LINUX_KUBE_RESERVED_MEMORY:-$(( 11 * EKS_LINUX_MAX_PODS + 255 ))Mi}"
export EKS_LINUX_POD_PIDS_LIMIT="${EKS_LINUX_POD_PIDS_LIMIT:-512}"
export EKS_LINUX_DISK_GB="${EKS_LINUX_DISK_GB:-30}"
export EKS_LINUX_LAUNCH_TEMPLATE="${EKS_LINUX_LAUNCH_TEMPLATE:-${EKS_CLUSTER_NAME:-devlabs}-labs-linux}"

# Docker-module learner machines: Linux boxes that also run dockerd, so each needs far more
# memory and disk than a plain box. One always-on base node; Karpenter adds the rest
# (labs-docker-elastic, karpenter/nodepool-docker.yaml), keep the two in sync.
# 17 pods on t4g.medium (4 GiB) = 5 DaemonSets (incl. NRI) + 12 boxes at 256Mi / 100m requested each.
# Not in EKS_NODEGROUPS yet: eks-docker.sh base/sleep/wake manage it on its own while the
# module is in its infrastructure spike.
export EKS_DOCKER_INSTANCE_TYPE="${EKS_DOCKER_INSTANCE_TYPE:-t4g.medium}"
export EKS_DOCKER_AMI_TYPE="${EKS_DOCKER_AMI_TYPE:-AL2023_ARM_64_STANDARD}"
export EKS_DOCKER_DESIRED="${EKS_DOCKER_DESIRED:-1}"
export EKS_DOCKER_MAX="${EKS_DOCKER_MAX:-1}"
export EKS_DOCKER_MAX_PODS="${EKS_DOCKER_MAX_PODS:-17}"
export EKS_DOCKER_KUBE_RESERVED_MEMORY="${EKS_DOCKER_KUBE_RESERVED_MEMORY:-$(( 11 * EKS_DOCKER_MAX_PODS + 255 ))Mi}"
export EKS_DOCKER_POD_PIDS_LIMIT="${EKS_DOCKER_POD_PIDS_LIMIT:-1024}"
# Image layers live on the node disk (/var/lib/docker is an emptyDir per box).
export EKS_DOCKER_DISK_GB="${EKS_DOCKER_DISK_GB:-100}"
export EKS_DOCKER_LAUNCH_TEMPLATE="${EKS_DOCKER_LAUNCH_TEMPLATE:-${EKS_CLUSTER_NAME:-devlabs}-labs-docker}"

# VPC CNI add-on configuration (prefix delegation: /28 per ENI slot).
# MINIMUM_IP_TARGET=80 keeps 5 prefixes per node: 42 pods plus the IPs of just-deleted pods,
# which stay unusable for IP_COOLDOWN_PERIOD (30 s). With only one spare prefix, bursts of
# pod churn (balloons replaced by learner pods) waited ~40 s for an IP.
# enableNetworkPolicy runs the network policy agent, without which every NetworkPolicy
# (dl-box-isolation in lx-* / dk-*, learners' own in ns-*) is stored but not enforced.
_default_vpc_cni_config='{"enableNetworkPolicy":"true","env":{"ENABLE_PREFIX_DELEGATION":"true","MINIMUM_IP_TARGET":"80","WARM_IP_TARGET":"16"}}'
export EKS_VPC_CNI_CONFIG="${EKS_VPC_CNI_CONFIG:-$_default_vpc_cni_config}"
unset _default_vpc_cni_config

export EKS_NODE_DISK_GB="${EKS_NODE_DISK_GB:-25}"

# Karpenter (elastic learner nodes on top of labs-k8s); see eks-karpenter.sh
export KARPENTER_VERSION="${KARPENTER_VERSION:-1.14.1}"
# Kyverno (injects karpenter.sh/do-not-disrupt on learner pods); see eks-kyverno.sh
export KYVERNO_CHART_VERSION="${KYVERNO_CHART_VERSION:-3.9.1}"

# Where to write kubeconfig (EC2 host path used by compose)
export EKS_KUBECONFIG_OUT="${EKS_KUBECONFIG_OUT:-./kube/k8s-lab.kubeconfig}"

eks_need_aws() {
  if ! command -v aws >/dev/null 2>&1; then
    echo "aws CLI not found" >&2
    exit 1
  fi
}

eks_csv_to_lines() {
  local csv="$1"
  echo "$csv" | tr ',' '\n' | sed '/^[[:space:]]*$/d'
}

# Per-node-group settings: eks_ng <field> <nodegroup>
# fields: instance-type | ami-type | labels | taints | desired | min | max
eks_ng() {
  local field="$1" ng="$2" prefix
  case "$ng" in
    system-k8s) prefix=SYSTEM ;;
    labs-k8s) prefix=LABS ;;
    labs-linux) prefix=LINUX ;;
    labs-docker) prefix=DOCKER ;;
    *) echo "unknown nodegroup: $ng (add it to eks_ng in env.sh)" >&2; return 1 ;;
  esac
  local var
  case "$field" in
    instance-type) var="EKS_${prefix}_INSTANCE_TYPE"; echo "${!var}" ;;
    ami-type) var="EKS_${prefix}_AMI_TYPE"; echo "${!var}" ;;
    labels)
      case "$ng" in
        labs-k8s) echo "devlabs.io/pool=labs" ;;
        # tier=base: boxes prefer this node over Karpenter's (linuxBox.ts).
        labs-linux) echo "devlabs.io/pool=linux,devlabs.io/tier=base" ;;
        labs-docker) echo "devlabs.io/pool=docker,devlabs.io/tier=base" ;;
        *) echo "devlabs.io/pool=system" ;;
      esac ;;
    taints)
      case "$ng" in
        # Learner pods carry no tolerations, so this keeps them off system nodes.
        # EKS add-ons (coredns, ebs-csi, metrics-server, snapshot-controller) tolerate it.
        system-k8s) echo "key=CriticalAddonsOnly,value=true,effect=NO_SCHEDULE" ;;
        # Same taint as labs-linux-elastic: only boxes and the NRI plugin tolerate it.
        labs-linux) echo "key=devlabs.io/pool,value=linux,effect=NO_SCHEDULE" ;;
        labs-docker) echo "key=devlabs.io/pool,value=docker,effect=NO_SCHEDULE" ;;
        *) echo "" ;;
      esac ;;
    desired) var="EKS_${prefix}_DESIRED"; echo "${EKS_WAKE_DESIRED:-${!var}}" ;;
    min) var="EKS_${prefix}_DESIRED"; echo "${EKS_WAKE_MIN:-${!var}}" ;;
    max) var="EKS_${prefix}_MAX"; echo "${EKS_WAKE_MAX:-${!var}}" ;;
    *) echo "unknown field: $field" >&2; return 1 ;;
  esac
}

eks_cluster_exists() {
  aws eks describe-cluster --name "$EKS_CLUSTER_NAME" --region "$AWS_REGION" >/dev/null 2>&1
}

eks_wait_cluster_active() {
  echo "==> waiting for cluster $EKS_CLUSTER_NAME ACTIVE"
  aws eks wait cluster-active --name "$EKS_CLUSTER_NAME" --region "$AWS_REGION"
}

eks_wait_nodegroup_active() {
  local ng="$1"
  echo "==> waiting for nodegroup $ng ACTIVE"
  aws eks wait nodegroup-active \
    --cluster-name "$EKS_CLUSTER_NAME" \
    --nodegroup-name "$ng" \
    --region "$AWS_REGION"
}
