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
# shellcheck source=nodegroups.sh
source "$ROOT/nodegroups.sh"
eks_need_aws

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

# Idempotent: applies EKS_VPC_CNI_CONFIG (prefix delegation + network policy agent) to an
# existing vpc-cni add-on. Prefix delegation is used cleanly only by newly launched nodes;
# running nodes keep their secondary IPs. The policy agent starts on every node right away.
ensure_vpc_cni_config() {
  local have
  have="$(aws eks describe-addon --cluster-name "$EKS_CLUSTER_NAME" --region "$AWS_REGION" \
    --addon-name vpc-cni --query 'addon.configurationValues' --output text 2>/dev/null || true)"
  if [[ "$have" == "$EKS_VPC_CNI_CONFIG" ]]; then
    echo "==> vpc-cni configuration up to date"
    return
  fi
  echo "==> vpc-cni: apply configuration (prefix delegation, network policy)"
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
echo "      ./deploy/eks/eks-wake.sh              # system-k8s + labs-k8s + labs-linux nodes"
echo "      ./deploy/eks/eks-addon-placement.sh   # once a system-k8s node is Ready"
echo "      ./deploy/eks/eks-karpenter.sh         # Karpenter, NodePool, balloons"
echo "      ./deploy/eks/eks-kyverno.sh           # learner do-not-disrupt policy"
echo "      ./deploy/eks/eks-admission.sh         # learner quota / LimitRange policies"
echo "      ./deploy/eks/eks-linux.sh up          # labs-linux-elastic NodePool + NRI plugin"
echo "    Then copy the new kubeconfig to the App EC2 and restart the backend (endpoint + CA change)."
