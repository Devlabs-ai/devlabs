#!/usr/bin/env bash
# Print a compact snapshot of the live EKS + IAM wiring (for docs / drift check).
# Usage: ./deploy/eks/eks-status.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=env.sh
source "$ROOT/env.sh"
eks_need_aws

echo "region=$AWS_REGION cluster=$EKS_CLUSTER_NAME"
if ! eks_cluster_exists; then
  echo "status=MISSING"
  exit 0
fi

aws eks describe-cluster --name "$EKS_CLUSTER_NAME" --region "$AWS_REGION" \
  --query 'cluster.{status:status,version:version,endpoint:endpoint}' --output table

echo ""
echo "nodegroups:"
while IFS= read -r ng; do
  [[ -z "$ng" ]] && continue
  aws eks describe-nodegroup \
    --cluster-name "$EKS_CLUSTER_NAME" \
    --nodegroup-name "$ng" \
    --region "$AWS_REGION" \
    --query 'nodegroup.{name:nodegroupName,status:status,desired:scalingConfig.desiredSize,min:scalingConfig.minSize,max:scalingConfig.maxSize,types:instanceTypes}' \
    --output table 2>/dev/null || echo "  $ng: missing"
done < <(eks_csv_to_lines "$EKS_NODEGROUPS")

echo ""
echo "access entries:"
aws eks list-access-entries --cluster-name "$EKS_CLUSTER_NAME" --region "$AWS_REGION" --output table

echo ""
echo "addons:"
aws eks list-addons --cluster-name "$EKS_CLUSTER_NAME" --region "$AWS_REGION" --output table
