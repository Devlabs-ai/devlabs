#!/usr/bin/env bash
# Scale all managed node groups to Desired=0 (keeps EKS control plane + IAM).
# Usage (repo root):
#   ./deploy/eks/eks-sleep.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=env.sh
source "$ROOT/env.sh"
eks_need_aws

if ! eks_cluster_exists; then
  echo "cluster $EKS_CLUSTER_NAME not found in $AWS_REGION (already destroyed?)" >&2
  exit 1
fi

echo "==> sleep: scale node groups → 0 on $EKS_CLUSTER_NAME ($AWS_REGION)"
while IFS= read -r ng; do
  [[ -z "$ng" ]] && continue
  echo "--> $ng desired=0"
  aws eks update-nodegroup-config \
    --cluster-name "$EKS_CLUSTER_NAME" \
    --nodegroup-name "$ng" \
    --scaling-config "minSize=0,maxSize=$(eks_ng max "$ng"),desiredSize=0" \
    --region "$AWS_REGION" >/dev/null
done < <(eks_csv_to_lines "$EKS_NODEGROUPS")

echo "==> done (control plane still bills ~\$73/mo; nodes stop when ASG reaches 0)"
echo "    wake with: ./deploy/eks/eks-wake.sh"
