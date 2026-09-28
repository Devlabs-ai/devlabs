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

# Comma-separated managed node groups
export EKS_NODEGROUPS="${EKS_NODEGROUPS:-system-k8s,workload-v2}"
# Which groups to wake by default (workload stays 0 until you need more capacity)
export EKS_WAKE_NODEGROUPS="${EKS_WAKE_NODEGROUPS:-system-k8s}"
export EKS_WAKE_DESIRED="${EKS_WAKE_DESIRED:-1}"
export EKS_WAKE_MIN="${EKS_WAKE_MIN:-0}"
export EKS_WAKE_MAX="${EKS_WAKE_MAX:-2}"

export EKS_NODE_INSTANCE_TYPE="${EKS_NODE_INSTANCE_TYPE:-t3.medium}"
export EKS_NODE_DISK_GB="${EKS_NODE_DISK_GB:-25}"

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
