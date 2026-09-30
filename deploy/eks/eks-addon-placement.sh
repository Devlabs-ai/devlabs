#!/usr/bin/env bash
# Pin EKS add-on Deployments to system-k8s nodes (devlabs.io/pool=system).
# DaemonSets (aws-node, kube-proxy, ebs-csi-node, pod-identity-agent) still run on every node.
# Idempotent. Run only once a system node is Ready, or the add-ons go Pending (CoreDNS down).
#
# Usage: ./deploy/eks/eks-addon-placement.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=env.sh
source "$ROOT/env.sh"
eks_need_aws

SELECTOR='{"devlabs.io/pool":"system"}'

placement_config() {
  case "$1" in
    coredns|metrics-server|snapshot-controller) echo "{\"nodeSelector\":$SELECTOR}" ;;
    aws-ebs-csi-driver) echo "{\"controller\":{\"nodeSelector\":$SELECTOR}}" ;;
  esac
}

for addon in coredns metrics-server snapshot-controller aws-ebs-csi-driver; do
  want="$(placement_config "$addon")"
  have="$(aws eks describe-addon \
    --cluster-name "$EKS_CLUSTER_NAME" \
    --addon-name "$addon" \
    --region "$AWS_REGION" \
    --query 'addon.configurationValues' \
    --output text 2>/dev/null || true)"
  if [[ "$have" == "$want" ]]; then
    echo "--> $addon already pinned"
    continue
  fi
  echo "--> pin $addon → devlabs.io/pool=system"
  aws eks update-addon \
    --cluster-name "$EKS_CLUSTER_NAME" \
    --addon-name "$addon" \
    --region "$AWS_REGION" \
    --configuration-values "$want" \
    --resolve-conflicts OVERWRITE >/dev/null
done

echo "==> waiting for add-ons ACTIVE"
for addon in coredns metrics-server snapshot-controller aws-ebs-csi-driver; do
  aws eks wait addon-active \
    --cluster-name "$EKS_CLUSTER_NAME" \
    --addon-name "$addon" \
    --region "$AWS_REGION"
done
echo "==> done"
