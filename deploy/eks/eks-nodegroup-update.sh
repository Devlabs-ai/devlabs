#!/usr/bin/env bash
# Roll existing learner node groups onto the current launch template (nodegroups.sh) and the
# latest EKS AL2023 AMI for the cluster version. Use after changing a launch template
# (IMDS, sysctls, maxPods…) and on a regular schedule for kernel patches.
#
# EKS replaces the nodes one by one: every pod on an old node is evicted, so running
# learner boxes and k8s labs on that group end. Run it when no learners are active.
#
# Usage (repo root, AWS admin creds):
#   ./deploy/eks/eks-nodegroup-update.sh labs-linux
#   ./deploy/eks/eks-nodegroup-update.sh labs-k8s labs-linux labs-docker
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=env.sh
source "$ROOT/env.sh"
# shellcheck source=nodegroups.sh
source "$ROOT/nodegroups.sh"
eks_need_aws

if [[ $# -eq 0 ]]; then
  echo "usage: $0 <nodegroup>... (labs-k8s | labs-linux | labs-docker)" >&2
  exit 2
fi

for ng in "$@"; do
  case "$ng" in
    labs-k8s) lt="$EKS_LABS_LAUNCH_TEMPLATE" ;;
    labs-linux) lt="$EKS_LINUX_LAUNCH_TEMPLATE" ;;
    labs-docker) lt="$EKS_DOCKER_LAUNCH_TEMPLATE" ;;
    *) echo "no launch template for $ng" >&2; exit 2 ;;
  esac
  if ! aws eks describe-nodegroup --cluster-name "$EKS_CLUSTER_NAME" --nodegroup-name "$ng" \
    --region "$AWS_REGION" >/dev/null 2>&1; then
    echo "--> $ng: node group not found, skipping"
    continue
  fi
  ensure_launch_template "$ng"
  version="$(aws ec2 describe-launch-template-versions --region "$AWS_REGION" \
    --launch-template-name "$lt" --versions '$Default' \
    --query 'LaunchTemplateVersions[0].VersionNumber' --output text)"
  echo "==> $ng → launch template $lt version $version + latest AMI"
  aws eks update-nodegroup-version \
    --cluster-name "$EKS_CLUSTER_NAME" \
    --nodegroup-name "$ng" \
    --launch-template "name=${lt},version=${version}" \
    --region "$AWS_REGION" \
    --query 'update.{id:id,status:status}' --output text
  eks_wait_nodegroup_active "$ng"
done

echo "==> nodes"
kubectl get nodes -L devlabs.io/pool,eks.amazonaws.com/nodegroup 2>/dev/null || true
