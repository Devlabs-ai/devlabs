#!/usr/bin/env bash
# Ensure IAM user has EKS Access Entry + ClusterAdmin (for aws eks get-token from App EC2).
# Usage:
#   ./deploy/eks/eks-access.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=env.sh
source "$ROOT/env.sh"
eks_need_aws

if ! eks_cluster_exists; then
  echo "cluster $EKS_CLUSTER_NAME not found" >&2
  exit 1
fi

POLICY_ARN="arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"

echo "==> ensure access entry for $EKS_APP_USER_ARN"
if aws eks describe-access-entry \
  --cluster-name "$EKS_CLUSTER_NAME" \
  --principal-arn "$EKS_APP_USER_ARN" \
  --region "$AWS_REGION" >/dev/null 2>&1; then
  echo "    access entry exists"
else
  aws eks create-access-entry \
    --cluster-name "$EKS_CLUSTER_NAME" \
    --principal-arn "$EKS_APP_USER_ARN" \
    --type STANDARD \
    --region "$AWS_REGION" >/dev/null
  echo "    created access entry"
fi

echo "==> associate AmazonEKSClusterAdminPolicy (cluster scope)"
# Idempotent enough: associate fails if already linked — ignore.
aws eks associate-access-policy \
  --cluster-name "$EKS_CLUSTER_NAME" \
  --principal-arn "$EKS_APP_USER_ARN" \
  --policy-arn "$POLICY_ARN" \
  --access-scope type=cluster \
  --region "$AWS_REGION" >/dev/null 2>&1 \
  && echo "    associated" \
  || echo "    already associated (or associate skipped)"

echo "==> ensure inline policy DevLabsEksDescribe on $EKS_APP_USER_NAME"
aws iam put-user-policy \
  --user-name "$EKS_APP_USER_NAME" \
  --policy-name DevLabsEksDescribe \
  --policy-document "file://${ROOT}/iam/DevLabsEksDescribe.json"

echo "==> done"
