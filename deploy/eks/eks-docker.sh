#!/usr/bin/env bash
# Docker-module infrastructure on the devlabs cluster. Idempotent. Same shape as eks-linux.sh:
# an always-on managed node group (labs-docker) plus a Karpenter NodePool for overflow
# (labs-docker-elastic), and the in-cluster Docker Hub mirror the boxes pull through.
#
#   base   create the labs-docker managed node group + launch template if missing, scale to 1
#          (AWS admin creds: EKS + EC2 launch templates)
#   up     apply labs-docker-elastic, the NRI plugin on docker nodes and the registry mirror
#   sleep  park Docker capacity: elastic limit → 0 and its nodes removed, labs-docker → 0
#          (the mirror keeps running on system-k8s with its cache)
#   wake   labs-docker → 1, then `up`
#   spike  up + start the phase-0 spike box (deploy/eks/docker/spike.yaml), then check
#   check  re-run the capability checks against the running spike box
#   down   delete the spike box, the NRI plugin, labs-docker-elastic and the mirror (and its
#          cache); labs-docker → 0
#
# Needs Karpenter installed (eks-karpenter.sh) and devsetu/docker-lab pushed
# (./images/build-all.sh docker-lab).
#
# Usage (repo root, kubeconfig from eks-kubeconfig.sh):
#   ./deploy/eks/eks-docker.sh base && ./deploy/eks/eks-docker.sh spike
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=env.sh
source "$ROOT/env.sh"

export KUBECONFIG="${KUBECONFIG:-$EKS_KUBECONFIG_OUT}"
NS=dl-docker-spike
PODS=(box-docker)
POOL=labs-docker-elastic
MIRROR=registry-mirror.dl-mirror.svc.cluster.local:5000

base() {
  eks_need_aws
  # shellcheck source=nodegroups.sh
  source "$ROOT/nodegroups.sh"
  ensure_nodegroup labs-docker
  EKS_WAKE_NODEGROUPS=labs-docker "$ROOT/eks-wake.sh"
  echo "==> labs-docker base node"
  kubectl get nodes -l eks.amazonaws.com/nodegroup=labs-docker \
    -L devlabs.io/pool,devlabs.io/tier,node.kubernetes.io/instance-type
}

up() {
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
  kubectl apply -f "$ROOT/karpenter/nodepool-docker.yaml"
  kubectl get ec2nodeclass "$POOL"
  kubectl get nodepool "$POOL"
  echo "==> NRI plugin nri-cgroup-rw-docker (dl-system, every devlabs.io/pool=docker node)"
  kubectl apply -f "$ROOT/docker/nri-cgroup-rw.yaml"
  echo "==> registry mirror (dl-mirror, on system-k8s)"
  kubectl apply -f "$ROOT/docker/registry-mirror.yaml"
  if ! kubectl -n dl-mirror get secret registry-mirror-hub >/dev/null 2>&1; then
    echo "    note: no Docker Hub credentials (secret dl-mirror/registry-mirror-hub); pulls are"
    echo "    anonymous and rate-limited per IP. See deploy/eks/docker/registry-mirror.yaml."
  fi
  kubectl -n dl-mirror rollout status deploy/registry-mirror --timeout=5m
}

park_elastic() {
  if kubectl get nodepool "$POOL" >/dev/null 2>&1; then
    echo "==> NodePool $POOL: cpu limit → 0, remove its nodes"
    kubectl patch nodepool "$POOL" --type merge -p '{"spec":{"limits":{"cpu":"0"}}}'
    kubectl delete nodeclaims -l "karpenter.sh/nodepool=$POOL" --wait=true --timeout=10m
  fi
}

sleep_docker() {
  eks_need_aws
  park_elastic
  EKS_NODEGROUPS=labs-docker "$ROOT/eks-sleep.sh"
}

wake_docker() {
  eks_need_aws
  EKS_WAKE_NODEGROUPS=labs-docker "$ROOT/eks-wake.sh"
  up
}

# name|command (runs as root inside the box). Each one cleans up what it starts.
CHECKS=(
  "user namespace (uid_map)|awk 'NR==1 && !(\$1==0 && \$2==0) {ok=1} END {exit !ok}' /proc/self/uid_map"
  "systemd is PID 1|[ \"\$(cat /proc/1/comm)\" = systemd ]"
  "system running|timeout 60 systemctl is-system-running --wait | grep -qx running"
  "/var/lib/docker not on overlay|[ \"\$(stat -f -c %T /var/lib/docker)\" != overlayfs ]"
  "ip_forward on|[ \"\$(cat /proc/sys/net/ipv4/ip_forward)\" = 1 ]"
  "docker.service active|timeout 60 bash -c 'until systemctl is-active -q docker; do sleep 1; done'"
  "storage driver overlay2|[ \"\$(docker info -f '{{.Driver}}')\" = overlay2 ]"
  "cgroup driver systemd, v2|[ \"\$(docker info -f '{{.CgroupDriver}} {{.CgroupVersion}}')\" = 'systemd 2' ]"
  "iptables nat (docker chains)|iptables -t nat -S DOCKER >/dev/null"
  "learner uses docker without sudo|runuser -u learner -- docker ps -q"
  "mirror reachable from box|curl -fsS --max-time 5 -o /dev/null http://$MIRROR/v2/"
  "pull through mirror|docker pull -q alpine:3.20 >/dev/null"
  "image cached in mirror|curl -fsS --max-time 5 http://$MIRROR/v2/_catalog | grep -q library/alpine"
  "run a container|docker run --rm alpine:3.20 true"
  "container DNS + egress to mirror|docker run --rm alpine:3.20 wget -q -T 5 -O /dev/null http://$MIRROR/v2/"
  "publish a port (-p)|docker run -d --name spike-web -p 8081:80 nginx:alpine >/dev/null; ok=1; for i in \$(seq 15); do if curl -fsS -o /dev/null localhost:8081; then ok=0; break; fi; sleep 1; done; docker rm -f spike-web >/dev/null; exit \$ok"
  "user-defined network DNS|docker network create spike-net >/dev/null && docker run -d --name spike-a --network spike-net alpine:3.20 sleep 60 >/dev/null && docker run --rm --network spike-net alpine:3.20 ping -c1 -W3 spike-a >/dev/null; rc=\$?; docker rm -f spike-a >/dev/null; docker network rm spike-net >/dev/null; exit \$rc"
  "memory limit enforced|[ \"\$(docker run --rm --memory 64m alpine:3.20 cat /sys/fs/cgroup/memory.max)\" = 67108864 ]"
  "OOM kill inside limit|docker run --name spike-oom --memory 32m alpine:3.20 sh -c 'x=a; while :; do x=\$x\$x; done' >/dev/null 2>&1; r=\$(docker inspect -f '{{.State.OOMKilled}}' spike-oom); docker rm -f spike-oom >/dev/null; [ \"\$r\" = true ]"
  "build (BuildKit, multi-stage)|d=\$(mktemp -d) && printf 'FROM alpine:3.20 AS b\nRUN echo hi > /x\nFROM alpine:3.20\nCOPY --from=b /x /x\n' > \$d/Dockerfile && docker build -q -t spike-build \$d >/dev/null && [ \"\$(docker run --rm spike-build cat /x)\" = hi ]; rc=\$?; docker rmi -f spike-build >/dev/null 2>&1; rm -rf \$d; exit \$rc"
  "compose up (2 services)|d=\$(mktemp -d) && printf 'services:\n  web:\n    image: nginx:alpine\n  probe:\n    image: alpine:3.20\n    depends_on: [web]\n    command: sh -c \"for i in 1 2 3 4 5 6 7 8 9 10; do wget -q -T 2 -O /dev/null http://web && exit 0; sleep 1; done; exit 1\"\n' > \$d/compose.yaml && docker compose -p spike -f \$d/compose.yaml up --abort-on-container-exit --exit-code-from probe >/dev/null 2>&1; rc=\$?; docker compose -p spike -f \$d/compose.yaml down -t 1 >/dev/null 2>&1; rm -rf \$d; exit \$rc"
  "push to a local registry|docker run -d --name spike-reg -p 5001:5000 registry:3 >/dev/null; for i in \$(seq 15); do curl -fsS -o /dev/null localhost:5001/v2/ && break; sleep 1; done; docker tag alpine:3.20 localhost:5001/spike/alpine:1 && docker push -q localhost:5001/spike/alpine:1 >/dev/null; rc=\$?; docker rm -f spike-reg >/dev/null; docker rmi localhost:5001/spike/alpine:1 >/dev/null 2>&1; exit \$rc"
  "restart policy brings it back|docker run -d --name spike-rs --restart on-failure alpine:3.20 sh -c 'sleep 2; exit 1' >/dev/null; sleep 8; n=\$(docker inspect -f '{{.RestartCount}}' spike-rs); docker rm -f spike-rs >/dev/null; [ \"\$n\" -ge 1 ]"
  # No -f: any HTTP answer (even 401) means the connection got out.
  "public internet blocked, box (needs NetworkPolicy agent)|! curl -s --max-time 5 -o /dev/null https://example.com"
  "public internet blocked, containers (needs NetworkPolicy agent)|! docker run --rm alpine:3.20 wget -q -T 5 -O /dev/null https://example.com"
)

check_pod() {
  local pod="$1" entry name cmd
  if ! kubectl -n "$NS" get pod "$pod" -o jsonpath='{.status.containerStatuses[0].state.running}' 2>/dev/null | grep -q .; then
    echo "--- $pod: not running"
    kubectl -n "$NS" get pod "$pod" -o wide || true
    kubectl -n "$NS" logs "$pod" --tail=30 2>/dev/null || true
    return
  fi
  echo "--- $pod ($(kubectl -n "$NS" get pod "$pod" -o jsonpath='{.spec.nodeName}'))"
  for entry in "${CHECKS[@]}"; do
    name="${entry%%|*}"
    cmd="${entry#*|}"
    if kubectl -n "$NS" exec "$pod" -- bash -c "$cmd" >/dev/null 2>&1; then
      printf '  PASS  %s\n' "$name"
    else
      printf '  FAIL  %s\n' "$name"
    fi
  done
  echo "  boot:    $(kubectl -n "$NS" exec "$pod" -- systemd-analyze 2>/dev/null | head -1 || echo n/a)"
  echo "  failed:  $(kubectl -n "$NS" exec "$pod" -- systemctl --failed --no-legend --plain 2>/dev/null | awk '{print $1}' | xargs || true)"
  echo "  docker:  $(kubectl -n "$NS" exec "$pod" -- docker info -f '{{.ServerVersion}} {{.Driver}} {{.CgroupDriver}}/v{{.CgroupVersion}}' 2>/dev/null || echo n/a)"
  echo "  disk:    $(kubectl -n "$NS" exec "$pod" -- du -sh /var/lib/docker 2>/dev/null | awk '{print $1}' || echo n/a) in /var/lib/docker"
  echo "  memory:  $(kubectl -n "$NS" top pod "$pod" --no-headers 2>/dev/null | awk '{print $3}' || echo n/a)"
  echo "  warnings:"
  kubectl -n "$NS" exec "$pod" -- bash -c 'docker info 2>&1 >/dev/null; journalctl -u docker -p warning --no-pager -q -o cat | tail -n 15' 2>/dev/null \
    | sed 's/^/    /' || true
}

check() {
  local pod
  for pod in "${PODS[@]}"; do
    check_pod "$pod"
  done
}

spike() {
  up
  echo "==> spike box ($NS)"
  kubectl apply -f "$ROOT/docker/spike.yaml"
  echo "==> waiting for the box (image pull on first run)"
  local pod
  for pod in "${PODS[@]}"; do
    kubectl -n "$NS" wait --for=condition=Ready "pod/$pod" --timeout=6m || true
  done
  # systemd (and dockerd after it) keep starting after the container is Ready.
  sleep 20
  check
}

down() {
  echo "==> delete spike box"
  kubectl delete namespace "$NS" --ignore-not-found --wait=true
  kubectl -n dl-system delete daemonset nri-cgroup-rw-docker --ignore-not-found
  echo "==> delete registry mirror (and its cache volume)"
  kubectl delete namespace dl-mirror --ignore-not-found --wait=true
  echo "==> delete NodePool $POOL (Karpenter terminates its nodes)"
  kubectl delete nodepool "$POOL" --ignore-not-found --wait=true --timeout=10m
  kubectl delete ec2nodeclass "$POOL" --ignore-not-found --wait=true --timeout=10m
  if eks_cluster_exists 2>/dev/null; then
    EKS_NODEGROUPS=labs-docker "$ROOT/eks-sleep.sh"
  fi
}

case "${1:-}" in
  base) base ;;
  up) up ;;
  sleep) sleep_docker ;;
  wake) wake_docker ;;
  spike) spike ;;
  check) check ;;
  down) down ;;
  *) echo "usage: $0 base|up|sleep|wake|spike|check|down" >&2; exit 2 ;;
esac
