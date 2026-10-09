#!/usr/bin/env bash
# Linux-module infrastructure on the devlabs cluster. Idempotent.
#
# Capacity mirrors the k8s labs: an always-on managed node group (labs-linux, like labs-k8s)
# plus a Karpenter NodePool for overflow (labs-linux-elastic, like labs-elastic).
#
#   base   create the labs-linux managed node group + launch template if missing, scale to 1
#          (AWS admin creds: EKS + EC2 launch templates)
#   up     apply the labs-linux-elastic EC2NodeClass + NodePool, the NRI plugin and the box
#          seccomp profiles (kubectl)
#   sleep  park Linux capacity: elastic limit → 0 and its nodes removed, labs-linux → 0
#   wake   labs-linux → 1, then `up` (restores the elastic limit)
#   spike  up + start the phase-0 spike boxes (deploy/eks/linux/spike.yaml), then check
#   check  re-run the capability checks against running spike boxes
#   seccomp  (re)install only the box seccomp profiles
#   down   delete the spike boxes, the NRI plugin, the seccomp profiles and labs-linux-elastic;
#          labs-linux → 0
#
# Needs Karpenter installed (eks-karpenter.sh) and devsetu/linux-lab pushed
# (./images/build-all.sh linux-lab).
#
# Usage (repo root, kubeconfig from eks-kubeconfig.sh):
#   ./deploy/eks/eks-linux.sh base && ./deploy/eks/eks-linux.sh up
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=env.sh
source "$ROOT/env.sh"

export KUBECONFIG="${KUBECONFIG:-$EKS_KUBECONFIG_OUT}"
NS=dl-linux-spike
PODS=(box-userns)
POOL=labs-linux-elastic

base() {
  eks_need_aws
  # shellcheck source=nodegroups.sh
  source "$ROOT/nodegroups.sh"
  ensure_nodegroup labs-linux
  EKS_WAKE_NODEGROUPS=labs-linux "$ROOT/eks-wake.sh"
  echo "==> labs-linux base node"
  kubectl get nodes -l eks.amazonaws.com/nodegroup=labs-linux \
    -L devlabs.io/pool,devlabs.io/tier,node.kubernetes.io/instance-type
}

up() {
  # Before labs-linux became a managed node group, the Karpenter pool had that name and
  # dl-linux-warm held one of its nodes up.
  kubectl -n dl-system delete deployment dl-linux-warm --ignore-not-found
  kubectl delete nodepool labs-linux --ignore-not-found --wait=true --timeout=10m
  kubectl delete ec2nodeclass labs-linux --ignore-not-found --wait=true --timeout=10m
  # Applying while a previous `down` is still finalizing leaves the NodePool pointing at
  # a deleted EC2NodeClass (pods stay Pending with "NodeClass not found").
  local kind
  for kind in nodepool ec2nodeclass; do
    if [[ -n "$(kubectl get "$kind" "$POOL" -o jsonpath='{.metadata.deletionTimestamp}' 2>/dev/null)" ]]; then
      echo "==> waiting for $kind $POOL to finish deleting"
      kubectl wait --for=delete "$kind/$POOL" --timeout=10m
    fi
  done
  echo "==> EC2NodeClass + NodePool $POOL"
  kubectl apply -f "$ROOT/karpenter/nodepool-linux.yaml"
  kubectl get ec2nodeclass "$POOL"
  kubectl get nodepool "$POOL"
  echo "==> NRI plugin nri-cgroup-rw (dl-system, every devlabs.io/pool=linux node)"
  kubectl apply -f "$ROOT/linux/nri-cgroup-rw.yaml"
  seccomp_profiles
}

# Box seccomp profiles (linux/seccomp/*.json) on every labs-linux node. Boxes fail to start
# until their node has the profile, so wait for the installer when a node is up.
seccomp_profiles() {
  echo "==> seccomp profiles (dl-system/seccomp-profiles → /var/lib/kubelet/seccomp/devlabs/)"
  kubectl apply -f "$ROOT/linux/seccomp-profiles.yaml"
  kubectl -n dl-system create configmap seccomp-profiles \
    --from-file="$ROOT/linux/seccomp/" --dry-run=client -o yaml | kubectl apply -f -
  if kubectl get nodes -l devlabs.io/pool=linux -o name | grep -q .; then
    kubectl -n dl-system rollout status ds/seccomp-profiles --timeout=3m
  fi
}

park_elastic() {
  if kubectl get nodepool "$POOL" >/dev/null 2>&1; then
    echo "==> NodePool $POOL: cpu limit → 0, remove its nodes"
    kubectl patch nodepool "$POOL" --type merge -p '{"spec":{"limits":{"cpu":"0"}}}'
    kubectl delete nodeclaims -l "karpenter.sh/nodepool=$POOL" --wait=true --timeout=10m
  fi
}

sleep_linux() {
  eks_need_aws
  park_elastic
  EKS_NODEGROUPS=labs-linux "$ROOT/eks-sleep.sh"
}

wake_linux() {
  eks_need_aws
  EKS_WAKE_NODEGROUPS=labs-linux "$ROOT/eks-wake.sh"
  up
}

# name|command (runs as root inside the box)
CHECKS=(
  "user namespace (uid_map)|awk 'NR==1 && !(\$1==0 && \$2==0) {ok=1} END {exit !ok}' /proc/self/uid_map"
  "systemd is PID 1|[ \"\$(cat /proc/1/comm)\" = systemd ]"
  "system running|timeout 60 systemctl is-system-running --wait | grep -qx running"
  "journalctl|journalctl -n 1 --no-pager -q"
  "learner sudo|runuser -u learner -- sudo -n true"
  "useradd / chown / userdel|useradd -m spiketest && touch /tmp/own && chown spiketest:spiketest /tmp/own && userdel -r spiketest"
  "ACLs|touch /tmp/acl && setfacl -m u:learner:r /tmp/acl && getfacl -p /tmp/acl | grep -q '^user:learner:r'"
  "custom unit start|printf '[Service]\nExecStart=/bin/sleep infinity\n' >/etc/systemd/system/spike.service && systemctl daemon-reload && systemctl start spike && systemctl is-active -q spike && systemctl stop spike"
  "cron active|systemctl is-active -q cron"
  "sshd on localhost|systemctl is-active -q ssh && timeout 10 ssh-keyscan -T 5 localhost 2>/dev/null | grep -q ssh-"
  "nftables|nft add table inet spike && nft delete table inet spike"
  "mount tmpfs|mkdir -p /mnt/spike && mount -t tmpfs none /mnt/spike && umount /mnt/spike"
  "loop + ext4 mount (optional)|truncate -s 32M /tmp/disk.img && mkfs.ext4 -qF /tmp/disk.img && mkdir -p /mnt/spike && mount -o loop /tmp/disk.img /mnt/spike && umount /mnt/spike"
  "renice below 0|nice -n -5 true"
  "strace|strace -o /dev/null true"
  "apt egress (fails once NetworkPolicy is enforced)|timeout 90 apt-get update -qq"
  "seccomp filter on PID 1|grep -Eq '^Seccomp:[[:space:]]+2' /proc/1/status"
  "io_uring blocked by seccomp|perl -e 'syscall(425, 1, 0); exit(\$!==38 ? 0 : 1)'"
  "nested user namespace blocked|! unshare -Ur true"
  "no failed units|[ -z \"\$(systemctl --failed --no-legend --plain)\" ]"
)

check_pod() {
  local pod="$1" entry name cmd
  if ! kubectl -n "$NS" get pod "$pod" -o jsonpath='{.status.containerStatuses[0].state.running}' 2>/dev/null | grep -q .; then
    echo "--- $pod: not running"
    kubectl -n "$NS" get pod "$pod" -o wide || true
    kubectl -n "$NS" logs "$pod" --tail=30 2>/dev/null || true
    return
  fi
  echo "--- $pod"
  for entry in "${CHECKS[@]}"; do
    name="${entry%%|*}"
    cmd="${entry#*|}"
    if kubectl -n "$NS" exec "$pod" -- bash -c "$cmd" >/dev/null 2>&1; then
      printf '  PASS  %s\n' "$name"
    else
      printf '  FAIL  %s\n' "$name"
    fi
  done
  echo "  boot:   $(kubectl -n "$NS" exec "$pod" -- systemd-analyze 2>/dev/null | head -1 || echo n/a)"
  echo "  failed: $(kubectl -n "$NS" exec "$pod" -- systemctl --failed --no-legend --plain 2>/dev/null | awk '{print $1}' | xargs || true)"
  echo "  memory: $(kubectl -n "$NS" top pod "$pod" --no-headers 2>/dev/null | awk '{print $3}' || echo n/a)"
}

check() {
  local pod
  for pod in "${PODS[@]}"; do
    check_pod "$pod"
  done
}

spike() {
  up
  echo "==> spike boxes ($NS)"
  kubectl apply -f "$ROOT/linux/spike.yaml"
  echo "==> waiting for boxes (image pull on first run)"
  local pod
  for pod in "${PODS[@]}"; do
    kubectl -n "$NS" wait --for=condition=Ready "pod/$pod" --timeout=6m || true
  done
  # systemd keeps starting units after the container is Ready.
  sleep 20
  check
}

down() {
  echo "==> delete spike boxes"
  kubectl delete namespace "$NS" --ignore-not-found --wait=true
  kubectl -n dl-system delete daemonset nri-cgroup-rw seccomp-profiles --ignore-not-found
  kubectl -n dl-system delete configmap seccomp-profiles --ignore-not-found
  echo "==> delete NodePool $POOL (Karpenter terminates its nodes)"
  kubectl delete nodepool "$POOL" --ignore-not-found --wait=true --timeout=10m
  kubectl delete ec2nodeclass "$POOL" --ignore-not-found --wait=true --timeout=10m
  if eks_cluster_exists 2>/dev/null; then
    EKS_NODEGROUPS=labs-linux "$ROOT/eks-sleep.sh"
  fi
}

case "${1:-}" in
  base) base ;;
  up) up ;;
  seccomp) seccomp_profiles ;;
  sleep) sleep_linux ;;
  wake) wake_linux ;;
  spike) spike ;;
  check) check ;;
  down) down ;;
  *) echo "usage: $0 base|up|seccomp|sleep|wake|spike|check|down" >&2; exit 2 ;;
esac
