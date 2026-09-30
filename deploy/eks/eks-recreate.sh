#!/usr/bin/env bash
# Recreate the DevSetu EKS cluster + node groups if missing, then wire app access + kubeconfig.
# Does NOT delete an existing healthy cluster — safe to re-run.
#
# Usage (from repo root, credentials that can manage EKS/IAM):
#   ./deploy/eks/eks-recreate.sh
#   EKS_KUBECONFIG_OUT=/opt/devlabs/kube/k8s-lab.kubeconfig ./deploy/eks/eks-recreate.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=env.sh
source "$ROOT/env.sh"
eks_need_aws

IFS=',' read -r -a SUBNETS <<< "$EKS_SUBNET_IDS"

create_cluster_if_needed() {
  if eks_cluster_exists; then
    echo "==> cluster $EKS_CLUSTER_NAME already exists"
    return
  fi
  echo "==> creating cluster $EKS_CLUSTER_NAME (version $EKS_VERSION)"
  aws eks create-cluster \
    --name "$EKS_CLUSTER_NAME" \
    --region "$AWS_REGION" \
    --kubernetes-version "$EKS_VERSION" \
    --role-arn "$EKS_CLUSTER_ROLE_ARN" \
    --resources-vpc-config "subnetIds=${EKS_SUBNET_IDS},endpointPublicAccess=true,endpointPrivateAccess=false" \
    --access-config authenticationMode=API_AND_CONFIG_MAP \
    >/dev/null
  eks_wait_cluster_active
}

ensure_nodegroup() {
  local ng="$1"
  if aws eks describe-nodegroup \
    --cluster-name "$EKS_CLUSTER_NAME" \
    --nodegroup-name "$ng" \
    --region "$AWS_REGION" >/dev/null 2>&1; then
    echo "==> nodegroup $ng already exists"
    return
  fi
  local instance_type ami_type labels taints max
  instance_type="$(eks_ng instance-type "$ng")"
  ami_type="$(eks_ng ami-type "$ng")"
  labels="$(eks_ng labels "$ng")"
  taints="$(eks_ng taints "$ng")"
  max="$(eks_ng max "$ng")"
  local taint_args=()
  [[ -n "$taints" ]] && taint_args=(--taints "$taints")
  # labs-k8s carries maxPods / kubeReserved in a launch template; disk size moves into it.
  local node_args=(--disk-size "$EKS_NODE_DISK_GB")
  if [[ "$ng" == labs-k8s ]]; then
    ensure_labs_launch_template
    node_args=(--launch-template "name=${EKS_LABS_LAUNCH_TEMPLATE}")
  fi
  echo "==> creating nodegroup $ng ($instance_type, $ami_type, desired=0)"
  aws eks create-nodegroup \
    --cluster-name "$EKS_CLUSTER_NAME" \
    --nodegroup-name "$ng" \
    --region "$AWS_REGION" \
    --node-role "$EKS_NODE_ROLE_ARN" \
    --subnets "${SUBNETS[@]}" \
    --instance-types "$instance_type" \
    --ami-type "$ami_type" \
    --labels "$labels" \
    ${taint_args[@]+"${taint_args[@]}"} \
    --capacity-type ON_DEMAND \
    "${node_args[@]}" \
    --scaling-config minSize=0,maxSize="$max",desiredSize=0 \
    >/dev/null
  eks_wait_nodegroup_active "$ng"
}

# Launch template for learner nodes: AL2023 nodeadm NodeConfig (maxPods + explicit
# kubeReserved, so the reserve matches the pod count) and the root volume.
# Idempotent: creates the template, or a new default version when the content changed.
# Existing node groups only pick up a new version via `aws eks update-nodegroup-version`.
ensure_labs_launch_template() {
  local userdata data current
  userdata="$(cat <<EOF | base64 | tr -d '\n'
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="BOUNDARY"

--BOUNDARY
Content-Type: application/node.eks.aws

apiVersion: node.eks.aws/v1alpha1
kind: NodeConfig
spec:
  kubelet:
    config:
      maxPods: ${EKS_LABS_MAX_PODS}
      kubeReserved:
        cpu: 70m
        memory: ${EKS_LABS_KUBE_RESERVED_MEMORY}
        ephemeral-storage: 1Gi
--BOUNDARY--
EOF
)"
  data="$(cat <<EOF
{
  "UserData": "${userdata}",
  "BlockDeviceMappings": [{
    "DeviceName": "/dev/xvda",
    "Ebs": {"VolumeSize": ${EKS_NODE_DISK_GB}, "VolumeType": "gp3", "Encrypted": true, "DeleteOnTermination": true}
  }],
  "MetadataOptions": {"HttpTokens": "required", "HttpPutResponseHopLimit": 2},
  "TagSpecifications": [{"ResourceType": "instance", "Tags": [{"Key": "devlabs.io/pool", "Value": "labs"}]}]
}
EOF
)"
  if ! aws ec2 describe-launch-templates --region "$AWS_REGION" \
    --launch-template-names "$EKS_LABS_LAUNCH_TEMPLATE" >/dev/null 2>&1; then
    echo "==> creating launch template $EKS_LABS_LAUNCH_TEMPLATE (maxPods=${EKS_LABS_MAX_PODS}, kubeReserved.memory=${EKS_LABS_KUBE_RESERVED_MEMORY})"
    aws ec2 create-launch-template --region "$AWS_REGION" \
      --launch-template-name "$EKS_LABS_LAUNCH_TEMPLATE" \
      --launch-template-data "$data" >/dev/null
    return
  fi
  current="$(aws ec2 describe-launch-template-versions --region "$AWS_REGION" \
    --launch-template-name "$EKS_LABS_LAUNCH_TEMPLATE" --versions '$Default' \
    --query 'LaunchTemplateVersions[0].LaunchTemplateData.UserData' --output text)"
  if [[ "$current" == "$userdata" ]]; then
    echo "==> launch template $EKS_LABS_LAUNCH_TEMPLATE up to date"
    return
  fi
  echo "==> launch template $EKS_LABS_LAUNCH_TEMPLATE changed → new default version"
  local version
  version="$(aws ec2 create-launch-template-version --region "$AWS_REGION" \
    --launch-template-name "$EKS_LABS_LAUNCH_TEMPLATE" \
    --launch-template-data "$data" \
    --query 'LaunchTemplateVersion.VersionNumber' --output text)"
  aws ec2 modify-launch-template --region "$AWS_REGION" \
    --launch-template-name "$EKS_LABS_LAUNCH_TEMPLATE" --default-version "$version" >/dev/null
}

ensure_addon() {
  local addon="$1"
  if aws eks describe-addon \
    --cluster-name "$EKS_CLUSTER_NAME" \
    --addon-name "$addon" \
    --region "$AWS_REGION" >/dev/null 2>&1; then
    echo "==> addon $addon already present"
    return
  fi
  echo "==> creating addon $addon"
  if [[ "$addon" == "vpc-cni" ]]; then
    aws eks create-addon \
      --cluster-name "$EKS_CLUSTER_NAME" \
      --addon-name "$addon" \
      --region "$AWS_REGION" \
      --configuration-values "$EKS_VPC_CNI_CONFIG" \
      --resolve-conflicts OVERWRITE >/dev/null || true
  elif [[ "$addon" == "aws-ebs-csi-driver" ]]; then
    # Pod Identity is required; without it ebs-plugin CrashLoops (no IMDS/IRSA creds).
    aws eks create-addon \
      --cluster-name "$EKS_CLUSTER_NAME" \
      --addon-name "$addon" \
      --region "$AWS_REGION" \
      --pod-identity-associations "serviceAccount=${EKS_EBS_CSI_SA},roleArn=${EKS_EBS_CSI_ROLE_ARN}" \
      --resolve-conflicts OVERWRITE >/dev/null || true
  else
    aws eks create-addon \
      --cluster-name "$EKS_CLUSTER_NAME" \
      --addon-name "$addon" \
      --region "$AWS_REGION" \
      --resolve-conflicts OVERWRITE >/dev/null || true
  fi
}

# Idempotent: applies prefix delegation to an existing vpc-cni add-on. Only newly
# launched nodes use it cleanly; running nodes keep their secondary IPs.
ensure_vpc_cni_config() {
  local have
  have="$(aws eks describe-addon --cluster-name "$EKS_CLUSTER_NAME" --region "$AWS_REGION" \
    --addon-name vpc-cni --query 'addon.configurationValues' --output text 2>/dev/null || true)"
  if [[ "$have" == "$EKS_VPC_CNI_CONFIG" ]]; then
    echo "==> vpc-cni prefix delegation already configured"
    return
  fi
  echo "==> vpc-cni: enable prefix delegation"
  aws eks update-addon --cluster-name "$EKS_CLUSTER_NAME" --region "$AWS_REGION" \
    --addon-name vpc-cni --configuration-values "$EKS_VPC_CNI_CONFIG" \
    --resolve-conflicts PRESERVE >/dev/null
  aws eks wait addon-active --cluster-name "$EKS_CLUSTER_NAME" --region "$AWS_REGION" --addon-name vpc-cni
}

# Idempotent: covers "addon already existed without association" (e.g. older recreates).
ensure_ebs_csi_pod_identity() {
  echo "==> ensure EBS CSI Pod Identity ($EKS_EBS_CSI_NAMESPACE/$EKS_EBS_CSI_SA)"
  local existing
  existing="$(aws eks list-pod-identity-associations \
    --cluster-name "$EKS_CLUSTER_NAME" \
    --region "$AWS_REGION" \
    --namespace "$EKS_EBS_CSI_NAMESPACE" \
    --service-account "$EKS_EBS_CSI_SA" \
    --query 'associations[0].associationId' \
    --output text 2>/dev/null || true)"
  if [[ -n "$existing" && "$existing" != "None" ]]; then
    echo "    association exists ($existing)"
    return
  fi
  aws eks create-pod-identity-association \
    --cluster-name "$EKS_CLUSTER_NAME" \
    --region "$AWS_REGION" \
    --namespace "$EKS_EBS_CSI_NAMESPACE" \
    --service-account "$EKS_EBS_CSI_SA" \
    --role-arn "$EKS_EBS_CSI_ROLE_ARN" >/dev/null
  echo "    created → $EKS_EBS_CSI_ROLE_ARN"
}

create_cluster_if_needed

while IFS= read -r ng; do
  [[ -z "$ng" ]] && continue
  ensure_nodegroup "$ng"
done < <(eks_csv_to_lines "$EKS_NODEGROUPS")

for addon in vpc-cni coredns kube-proxy eks-pod-identity-agent metrics-server aws-ebs-csi-driver snapshot-controller; do
  ensure_addon "$addon"
done

ensure_vpc_cni_config
ensure_ebs_csi_pod_identity

"$ROOT/eks-access.sh"
"$ROOT/eks-kubeconfig.sh"

echo ""
echo "==> recreate complete"
echo "    Nodes are Desired=0. Then, in order (each needs the previous one):"
echo "      ./deploy/eks/eks-wake.sh              # system-k8s + labs-k8s nodes"
echo "      ./deploy/eks/eks-addon-placement.sh   # once a system-k8s node is Ready"
echo "      ./deploy/eks/eks-karpenter.sh         # Karpenter, NodePool, balloons"
echo "      ./deploy/eks/eks-kyverno.sh           # learner do-not-disrupt policy"
echo "      ./deploy/eks/eks-admission.sh         # learner quota / LimitRange policies"
echo "    Then copy the new kubeconfig to the App EC2 and restart the backend (endpoint + CA change)."
