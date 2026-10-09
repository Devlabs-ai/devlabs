#!/usr/bin/env bash
# Managed node group helpers, sourced by eks-recreate.sh and eks-linux.sh (after env.sh).

IFS=',' read -r -a SUBNETS <<< "$EKS_SUBNET_IDS"

# Creates the group at desired=0 if missing; eks-wake.sh scales it up.
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
  # Learner groups carry maxPods / kubeReserved in a launch template; disk size moves into it.
  local node_args=(--disk-size "$EKS_NODE_DISK_GB")
  case "$ng" in
    labs-k8s)
      ensure_launch_template labs-k8s
      node_args=(--launch-template "name=${EKS_LABS_LAUNCH_TEMPLATE}")
      ;;
    labs-linux)
      ensure_launch_template labs-linux
      node_args=(--launch-template "name=${EKS_LINUX_LAUNCH_TEMPLATE}")
      ;;
    labs-docker)
      ensure_launch_template labs-docker
      node_args=(--launch-template "name=${EKS_DOCKER_LAUNCH_TEMPLATE}")
      ;;
  esac
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
# kubeReserved, so the reserve matches the pod count; podPidsLimit on Linux), a boot script
# that disables io_uring, the root volume, and IMDS limited to the host (hop limit 1, so
# learner pods cannot fetch the node role's credentials; host-network DaemonSets still can).
# Idempotent: creates the template, or a new default version when the content changed
# (tracked by a checksum in the version description). Existing node groups only pick up a
# new version via eks-nodegroup-update.sh (`aws eks update-nodegroup-version`).
ensure_launch_template() {
  local ng="$1" name max_pods reserved disk pool extra=""
  case "$ng" in
    labs-k8s)
      name="$EKS_LABS_LAUNCH_TEMPLATE"; max_pods="$EKS_LABS_MAX_PODS"
      reserved="$EKS_LABS_KUBE_RESERVED_MEMORY"; disk="$EKS_NODE_DISK_GB"; pool=labs
      ;;
    labs-linux)
      name="$EKS_LINUX_LAUNCH_TEMPLATE"; max_pods="$EKS_LINUX_MAX_PODS"
      reserved="$EKS_LINUX_KUBE_RESERVED_MEMORY"; disk="$EKS_LINUX_DISK_GB"; pool=linux
      # One box's fork bomb must not use up the node's ~30k threads.
      extra="      podPidsLimit: ${EKS_LINUX_POD_PIDS_LIMIT}
"
      ;;
    labs-docker)
      name="$EKS_DOCKER_LAUNCH_TEMPLATE"; max_pods="$EKS_DOCKER_MAX_PODS"
      reserved="$EKS_DOCKER_KUBE_RESERVED_MEMORY"; disk="$EKS_DOCKER_DISK_GB"; pool=docker
      # The box's own containers count against it too.
      extra="      podPidsLimit: ${EKS_DOCKER_POD_PIDS_LIMIT}
"
      ;;
    *) echo "no launch template for $ng" >&2; return 1 ;;
  esac
  local userdata data checksum current
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
      maxPods: ${max_pods}
${extra}      kubeReserved:
        cpu: 70m
        memory: ${reserved}
        ephemeral-storage: 1Gi
--BOUNDARY
Content-Type: text/x-shellscript; charset="us-ascii"

#!/bin/bash
# Nothing in the labs uses io_uring, and it is a frequent source of kernel privilege
# escalation bugs reachable from containers.
printf 'kernel.io_uring_disabled = 2\n' > /etc/sysctl.d/90-devlabs-learner.conf
sysctl -p /etc/sysctl.d/90-devlabs-learner.conf
--BOUNDARY--
EOF
)"
  data="$(cat <<EOF
{
  "UserData": "${userdata}",
  "BlockDeviceMappings": [{
    "DeviceName": "/dev/xvda",
    "Ebs": {"VolumeSize": ${disk}, "VolumeType": "gp3", "Encrypted": true, "DeleteOnTermination": true}
  }],
  "MetadataOptions": {"HttpTokens": "required", "HttpPutResponseHopLimit": 1},
  "TagSpecifications": [{"ResourceType": "instance", "Tags": [{"Key": "devlabs.io/pool", "Value": "${pool}"}]}]
}
EOF
)"
  checksum="devlabs-cksum-$(printf '%s' "$data" | cksum | awk '{print $1}')"
  if ! aws ec2 describe-launch-templates --region "$AWS_REGION" \
    --launch-template-names "$name" >/dev/null 2>&1; then
    echo "==> creating launch template $name (maxPods=${max_pods}, kubeReserved.memory=${reserved})"
    aws ec2 create-launch-template --region "$AWS_REGION" \
      --launch-template-name "$name" \
      --version-description "$checksum" \
      --launch-template-data "$data" >/dev/null
    return
  fi
  current="$(aws ec2 describe-launch-template-versions --region "$AWS_REGION" \
    --launch-template-name "$name" --versions '$Default' \
    --query 'LaunchTemplateVersions[0].VersionDescription' --output text)"
  if [[ "$current" == "$checksum" ]]; then
    echo "==> launch template $name up to date"
    return
  fi
  echo "==> launch template $name changed → new default version"
  local version
  version="$(aws ec2 create-launch-template-version --region "$AWS_REGION" \
    --launch-template-name "$name" \
    --version-description "$checksum" \
    --launch-template-data "$data" \
    --query 'LaunchTemplateVersion.VersionNumber' --output text)"
  aws ec2 modify-launch-template --region "$AWS_REGION" \
    --launch-template-name "$name" --default-version "$version" >/dev/null
}
