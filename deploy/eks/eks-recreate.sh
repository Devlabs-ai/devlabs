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
  echo "==> creating nodegroup $ng ($EKS_NODE_INSTANCE_TYPE, desired=0)"
  aws eks create-nodegroup \
    --cluster-name "$EKS_CLUSTER_NAME" \
    --nodegroup-name "$ng" \
    --region "$AWS_REGION" \
    --node-role "$EKS_NODE_ROLE_ARN" \
    --subnets "${SUBNETS[@]}" \
    --instance-types "$EKS_NODE_INSTANCE_TYPE" \
    --ami-type AL2023_x86_64_STANDARD \
    --capacity-type ON_DEMAND \
    --disk-size "$EKS_NODE_DISK_GB" \
    --scaling-config minSize=0,maxSize="${EKS_WAKE_MAX}",desiredSize=0 \
    >/dev/null
  eks_wait_nodegroup_active "$ng"
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
  if [[ "$addon" == "aws-ebs-csi-driver" ]]; then
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

ensure_ebs_csi_pod_identity

"$ROOT/eks-access.sh"
"$ROOT/eks-kubeconfig.sh"

echo ""
echo "==> recreate complete"
echo "    Nodes are Desired=0. Wake when you need labs:"
echo "      ./deploy/eks/eks-wake.sh"
echo "    Then restart backend on EC2 if kubeconfig path changed."
