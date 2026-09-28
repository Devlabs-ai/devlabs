#!/usr/bin/env bash
# Delete managed node groups + EKS cluster (stops ~$73/mo control plane).
# Preserves: App EC2, S3, IAM users/roles/policies, learner homes on EC2.
#
# Usage:
#   ./deploy/eks/eks-destroy.sh          # interactive confirm
#   ./deploy/eks/eks-destroy.sh --yes    # no prompt
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=env.sh
source "$ROOT/env.sh"
eks_need_aws

YES=0
if [[ "${1:-}" == "--yes" || "${1:-}" == "-y" ]]; then
  YES=1
fi

if ! eks_cluster_exists; then
  echo "cluster $EKS_CLUSTER_NAME already gone in $AWS_REGION"
  exit 0
fi

if [[ "$YES" -ne 1 ]]; then
  echo "This will DELETE EKS cluster '$EKS_CLUSTER_NAME' and node groups: $EKS_NODEGROUPS"
  echo "App EC2 / S3 / IAM / kube/homes are NOT deleted."
  read -r -p "Type the cluster name to confirm: " ans
  if [[ "$ans" != "$EKS_CLUSTER_NAME" ]]; then
    echo "aborted"
    exit 1
  fi
fi

echo "==> deleting node groups"
while IFS= read -r ng; do
  [[ -z "$ng" ]] && continue
  if aws eks describe-nodegroup \
    --cluster-name "$EKS_CLUSTER_NAME" \
    --nodegroup-name "$ng" \
    --region "$AWS_REGION" >/dev/null 2>&1; then
    echo "--> delete nodegroup $ng"
    aws eks delete-nodegroup \
      --cluster-name "$EKS_CLUSTER_NAME" \
      --nodegroup-name "$ng" \
      --region "$AWS_REGION" >/dev/null
  else
    echo "--> nodegroup $ng already gone"
  fi
done < <(eks_csv_to_lines "$EKS_NODEGROUPS")

echo "==> waiting for node groups to disappear"
while IFS= read -r ng; do
  [[ -z "$ng" ]] && continue
  for _ in $(seq 1 60); do
    if ! aws eks describe-nodegroup \
      --cluster-name "$EKS_CLUSTER_NAME" \
      --nodegroup-name "$ng" \
      --region "$AWS_REGION" >/dev/null 2>&1; then
      echo "    $ng gone"
      break
    fi
    sleep 15
  done
done < <(eks_csv_to_lines "$EKS_NODEGROUPS")

echo "==> deleting cluster $EKS_CLUSTER_NAME"
aws eks delete-cluster --name "$EKS_CLUSTER_NAME" --region "$AWS_REGION" >/dev/null
echo "==> waiting for cluster delete"
aws eks wait cluster-deleted --name "$EKS_CLUSTER_NAME" --region "$AWS_REGION" 2>/dev/null || true

echo "==> destroyed"
echo "    Recreate later with: ./deploy/eks/eks-recreate.sh && ./deploy/eks/eks-wake.sh"
