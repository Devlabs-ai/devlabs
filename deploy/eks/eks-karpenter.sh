#!/usr/bin/env bash
# Install / upgrade Karpenter on the devlabs cluster. Idempotent.
#   - IAM via the upstream CloudFormation template (node role, controller policies, interruption queue)
#   - controller role bound with EKS Pod Identity (kube-system/karpenter)
#   - access entry so Karpenter-launched nodes can join
#   - karpenter.sh/discovery tags on subnets + cluster security group
#   - Helm chart on system-k8s nodes, then EC2NodeClass + NodePool (karpenter/nodepool.yaml)
#
# Usage (repo root, admin creds, kubeconfig from eks-kubeconfig.sh):
#   ./deploy/eks/eks-karpenter.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=env.sh
source "$ROOT/env.sh"
eks_need_aws

export KUBECONFIG="${KUBECONFIG:-$EKS_KUBECONFIG_OUT}"
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
STACK="Karpenter-${EKS_CLUSTER_NAME}"
NODE_ROLE="KarpenterNodeRole-${EKS_CLUSTER_NAME}"
CONTROLLER_ROLE="KarpenterControllerRole-${EKS_CLUSTER_NAME}"

echo "==> CloudFormation $STACK (Karpenter $KARPENTER_VERSION IAM + interruption queue)"
aws cloudformation deploy \
  --region "$AWS_REGION" \
  --stack-name "$STACK" \
  --template-file "$ROOT/karpenter/cloudformation.yaml" \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides "ClusterName=${EKS_CLUSTER_NAME}" \
  --no-fail-on-empty-changeset

echo "==> controller role $CONTROLLER_ROLE (Pod Identity)"
if ! aws iam get-role --role-name "$CONTROLLER_ROLE" >/dev/null 2>&1; then
  aws iam create-role \
    --role-name "$CONTROLLER_ROLE" \
    --assume-role-policy-document '{
      "Version": "2012-10-17",
      "Statement": [{
        "Effect": "Allow",
        "Principal": {"Service": "pods.eks.amazonaws.com"},
        "Action": ["sts:AssumeRole", "sts:TagSession"]
      }]
    }' >/dev/null
fi
for policy in NodeLifecycle IAMIntegration EKSIntegration Interruption ZonalShift ResourceDiscovery; do
  aws iam attach-role-policy \
    --role-name "$CONTROLLER_ROLE" \
    --policy-arn "arn:aws:iam::${ACCOUNT_ID}:policy/KarpenterController${policy}Policy-${EKS_CLUSTER_NAME}"
done

existing="$(aws eks list-pod-identity-associations \
  --cluster-name "$EKS_CLUSTER_NAME" --region "$AWS_REGION" \
  --namespace kube-system --service-account karpenter \
  --query 'associations[0].associationId' --output text 2>/dev/null || true)"
if [[ -z "$existing" || "$existing" == "None" ]]; then
  aws eks create-pod-identity-association \
    --cluster-name "$EKS_CLUSTER_NAME" --region "$AWS_REGION" \
    --namespace kube-system --service-account karpenter \
    --role-arn "arn:aws:iam::${ACCOUNT_ID}:role/${CONTROLLER_ROLE}" >/dev/null
fi

echo "==> access entry for $NODE_ROLE (EC2_LINUX)"
aws eks create-access-entry \
  --cluster-name "$EKS_CLUSTER_NAME" --region "$AWS_REGION" \
  --principal-arn "arn:aws:iam::${ACCOUNT_ID}:role/${NODE_ROLE}" \
  --type EC2_LINUX >/dev/null 2>&1 || echo "    exists"

echo "==> discovery tags (subnets + cluster security group)"
CLUSTER_SG="$(aws eks describe-cluster --name "$EKS_CLUSTER_NAME" --region "$AWS_REGION" \
  --query 'cluster.resourcesVpcConfig.clusterSecurityGroupId' --output text)"
IFS=',' read -r -a SUBNETS <<< "$EKS_SUBNET_IDS"
aws ec2 create-tags --region "$AWS_REGION" \
  --resources "${SUBNETS[@]}" "$CLUSTER_SG" \
  --tags "Key=karpenter.sh/discovery,Value=${EKS_CLUSTER_NAME}"

echo "==> helm karpenter $KARPENTER_VERSION → kube-system (system-k8s)"
helm upgrade --install karpenter oci://public.ecr.aws/karpenter/karpenter \
  --version "$KARPENTER_VERSION" \
  --namespace kube-system \
  --set "settings.clusterName=${EKS_CLUSTER_NAME}" \
  --set "settings.interruptionQueue=${EKS_CLUSTER_NAME}" \
  --set replicas=1 \
  --set 'nodeSelector.devlabs\.io/pool=system' \
  --set 'tolerations[0].key=CriticalAddonsOnly' \
  --set 'tolerations[0].operator=Exists' \
  --set controller.resources.requests.cpu=200m \
  --set controller.resources.requests.memory=512Mi \
  --set controller.resources.limits.memory=1Gi \
  --wait

# EKS_KARPENTER_LABS_POOL=0 installs only the controller (e.g. a Docker-only cluster):
# without a labs-k8s base, the balloons would make Karpenter buy labs-elastic nodes.
if [[ "${EKS_KARPENTER_LABS_POOL:-1}" == "1" ]]; then
  echo "==> EC2NodeClass + NodePool"
  kubectl apply -f "$ROOT/karpenter/nodepool.yaml"
  kubectl get ec2nodeclass,nodepool

  echo "==> balloons (dl-system/dl-balloon)"
  kubectl apply -f "$ROOT/karpenter/balloons.yaml"
else
  echo "==> EKS_KARPENTER_LABS_POOL=0: skip labs-elastic NodePool and balloons"
fi

echo "==> done"
