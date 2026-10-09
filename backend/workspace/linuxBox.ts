'use strict';

/**
 * Box-lab learner machines: one pod `box` per learner, running systemd as PID 1 with a
 * sudo-capable `learner`. Two flavors (challenges/labTypes):
 *   linux  — namespace lx-<user>, images/linux-lab, labs-linux pool
 *   docker — namespace dk-<user>, images/docker-lab (linux-lab + dockerd), labs-docker
 *            pool; pulls images only through the in-cluster mirror (dl-mirror)
 *
 * The pod is user-namespaced (hostUsers: false), so root and the added capabilities
 * only apply inside it; the nri-cgroup-rw plugin on box nodes makes its cgroupfs
 * writable so systemd (and dockerd's per-container cgroups) work (deploy/eks/linux/,
 * deploy/eks/docker/). Linux boxes run the devlabs/linux-box.json seccomp profile, which
 * the seccomp-profiles DaemonSet installs on every labs-linux node. Learners get no
 * Kubernetes API access here: the backend creates the pod and the terminal execs into it
 * with controller credentials.
 *
 * Machines are not persisted: every open starts a fresh box and runs setup.sh;
 * ending the lab deletes it.
 *
 * No-root labs (platformSpec.box.unprivileged, the free shell/file-navigation set) skip
 * systemd and the added capabilities: a plain `sleep infinity` PID 1, RuntimeDefault
 * seccomp, and only the caps setup.sh and runuser->learner need. This keeps the kernel
 * attack surface of the untrusted free tier at the container-runtime baseline.
 */

import type { BoxFlavor, LinuxBoxSpec } from '../types/domain';

const k8s = require('./k8sCluster');

const BOX_POD = 'box';
const BOX_CONTAINER = 'box';
const LEARNER_USER = 'learner';
/** Covers a cold start (~50 s: Karpenter node ~31 s + image pull ~9 s + systemd boot ~10 s). */
const READY_TIMEOUT_S = Math.max(60, Number(process.env.LINUX_LAB_READY_TIMEOUT_S || 300));
const MIRROR_NAMESPACE = 'dl-mirror';

type Flavor = {
  nsPrefix: string;
  component: string;
  /** devlabs.io/pool label and taint of the flavor's node pool. */
  pool: string;
  image: string;
  resources: {
    requests: { cpu: string; memory: string; ephemeral: string };
    limits: { cpu: string; memory: string; ephemeral: string };
  };
  tmpSize: string;
  docker: boolean;
  /** Container seccompProfile, as YAML lines under `seccompProfile:`. */
  seccomp: string;
};

/**
 * LINUX_LAB_SECCOMP=unconfined is the escape hatch if the profile breaks a lab or is not
 * installed on the nodes yet (boxes then fail with CreateContainerError).
 */
const LINUX_SECCOMP = process.env.LINUX_LAB_SECCOMP === 'unconfined'
  ? 'type: Unconfined'
  : 'type: Localhost\n          localhostProfile: devlabs/linux-box.json';

const FLAVORS: Record<BoxFlavor, Flavor> = {
  /**
   * Sized for ~40 boxes per t4g.medium (deploy/eks/karpenter/nodepool-linux.yaml). Lab 18
   * mounts a 64 Mi tmpfs and needs ~85 Mi unreclaimable, so keep the memory limit well above.
   * Without an explicit ephemeral request the scheduler reserves the whole limit per box.
   */
  linux: {
    nsPrefix: 'lx-',
    component: 'linux-lab',
    pool: 'linux',
    image: process.env.LINUX_LAB_IMAGE || 'devsetu/linux-lab:v0.5',
    resources: {
      requests: { cpu: '25m', memory: '64Mi', ephemeral: '256Mi' },
      limits: { cpu: '250m', memory: '256Mi', ephemeral: '2Gi' },
    },
    tmpSize: '512Mi',
    docker: false,
    seccomp: LINUX_SECCOMP,
  },
  /**
   * ~12 boxes per t4g.medium (deploy/eks/karpenter/nodepool-docker.yaml). An idle box uses
   * ~46 Mi and a solved lab at most ~232 Mi (three Python services); image pulls take ~1 core
   * for a few seconds. The ephemeral limit covers the 10Gi /var/lib/docker emptyDir.
   */
  docker: {
    nsPrefix: 'dk-',
    component: 'docker-lab',
    pool: 'docker',
    image: process.env.DOCKER_LAB_IMAGE || 'devsetu/docker-lab:v0.2',
    resources: {
      requests: { cpu: '100m', memory: '256Mi', ephemeral: '1Gi' },
      limits: { cpu: '1000m', memory: '512Mi', ephemeral: '12Gi' },
    },
    tmpSize: '1Gi',
    docker: true,
    // dockerd and runc need syscalls the Linux profile blocks; needs its own profile.
    seccomp: 'type: Unconfined',
  },
};

/** lx-<user> / dk-<user>, same slug as the learner's Kubernetes namespace. */
function boxNamespace(userName: string, flavor: BoxFlavor): string {
  return String(k8s.learnerNamespace(userName)).replace(/^ns-/, FLAVORS[flavor].nsPrefix);
}

/**
 * Only the backend creates pods here, so the namespace runs the privileged Pod
 * Security level (the box adds capabilities and a custom seccomp profile). The
 * NetworkPolicy allows only same-namespace traffic and DNS (plus the registry mirror for
 * Docker boxes): no other boxes, VPC, instance metadata or public internet. Labs that need
 * the internet (apt) stay closed until boxes are hardened. It is enforced by the VPC CNI
 * network policy agent (enableNetworkPolicy in deploy/eks/env.sh).
 */
function namespaceYaml(ns: string, flavor: BoxFlavor): string {
  const f = FLAVORS[flavor];
  const mirrorLabel = f.docker ? '\n    devlabs.io/registry-mirror: client' : '';
  const mirrorEgress = f.docker
    ? `
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: ${MIRROR_NAMESPACE}
          podSelector:
            matchLabels:
              app: registry-mirror
      ports:
        - {protocol: TCP, port: 5000}`
    : '';
  return `
apiVersion: v1
kind: Namespace
metadata:
  name: ${ns}
  labels:
    app.kubernetes.io/managed-by: devlabs
    app.kubernetes.io/component: ${f.component}
    pod-security.kubernetes.io/enforce: privileged${mirrorLabel}
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: dl-box-isolation
  namespace: ${ns}
  labels:
    app.kubernetes.io/managed-by: devlabs
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
  ingress:
    - from:
        - podSelector: {}
  egress:
    - to:
        - podSelector: {}
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
          podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - {protocol: UDP, port: 53}
        - {protocol: TCP, port: 53}${mirrorEgress}
`;
}

function labelValue(raw: string): string {
  return raw.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 63).replace(/[^A-Za-z0-9]+$/, '');
}

function boxPodYaml(ns: string, challengeId: string, flavor: BoxFlavor, spec: LinuxBoxSpec = {}): string {
  const f = FLAVORS[flavor];
  // No-root labs (free shell/file-navigation set): plain machine, no systemd, no added
  // capabilities, RuntimeDefault seccomp. Only linux boxes; docker always needs root/dockerd.
  const unprivileged = flavor === 'linux' && spec.unprivileged === true;
  const res = {
    requests: { ...f.resources.requests, ...(spec.resources?.requests || {}) },
    limits: { ...f.resources.limits, ...(spec.resources?.limits || {}) },
  };
  // Ready = systemd finished booting ("degraded" still counts: a learner's broken unit
  // must not take the machine out of service); Docker boxes also wait for dockerd.
  const ready = 'case \\"$(systemctl is-system-running)\\" in running|degraded) ;; *) exit 1;; esac'
    + (f.docker ? '; systemctl is-active --quiet docker' : '');
  // procMount Unmasked (allowed only with hostUsers: false) leaves /proc/sys writable so
  // dockerd can set net.ipv4.ip_forward; net.* sysctls belong to the pod's own netns.
  // /var/lib/docker sits on an emptyDir: overlay2 cannot stack on the overlay rootfs.
  const procMount = f.docker ? '\n        procMount: Unmasked' : '';
  const dockerMount = f.docker ? '\n        - {name: docker, mountPath: /var/lib/docker}' : '';
  const dockerVolume = f.docker ? '\n    - name: docker\n      emptyDir: {sizeLimit: 10Gi}' : '';
  // The cgroup-rw NRI plugin only acts on this annotation, so no-root boxes (no systemd)
  // skip it and keep the read-only cgroupfs.
  const cgroupAnnotation = unprivileged ? '' : '\n    devlabs.io/cgroup-rw: "true"';
  // No-root box: drop the box's added powers (the SYS_ADMIN/NET_ADMIN escape surface) and
  // the custom seccomp exemptions; keep only the caps setup.sh and runuser->learner need.
  const securityContext = unprivileged
    ? `      securityContext:
        capabilities:
          drop: [ALL]
          add: [SETUID, SETGID, CHOWN, DAC_OVERRIDE, FOWNER, FSETID]
        seccompProfile:
          type: RuntimeDefault`
    : `      securityContext:${procMount}
        capabilities:
          add: [SYS_ADMIN, NET_ADMIN, NET_RAW, SYS_PTRACE, SYS_RESOURCE, SYS_NICE, AUDIT_WRITE]
        seccompProfile:
          ${f.seccomp}`;
  // Every box drops a .hushlogin so Ubuntu's /etc/bash.bashrc "use sudo" login hint never
  // shows (we don't want sudo/root chatter in the banner). No-root boxes have no systemd, so
  // PID 1 is a plain idle process (setup.sh execs in as root, the shell as learner); paid/
  // Docker boxes exec systemd as PID 1 (exec keeps it PID 1; image STOPSIGNAL still applies).
  const initCmd = unprivileged ? 'sleep infinity' : '/sbin/init';
  const command = `\n      command: ["/bin/sh", "-c", "touch /home/learner/.hushlogin 2>/dev/null; exec ${initCmd}"]`;
  const readinessProbe = unprivileged
    ? ''
    : `
      readinessProbe:
        exec:
          command: ["/bin/sh", "-c", "${ready}"]
        periodSeconds: 2
        timeoutSeconds: 5
        failureThreshold: 3`;
  return `
apiVersion: v1
kind: Pod
metadata:
  name: ${BOX_POD}
  namespace: ${ns}
  labels:
    app.kubernetes.io/managed-by: devlabs
    app: ${flavor}-box
    ${k8s.CHALLENGE_LABEL}: ${labelValue(challengeId)}
  annotations:
    karpenter.sh/do-not-disrupt: "true"${cgroupAnnotation}
spec:
  hostUsers: false
  hostname: ${spec.hostname || 'order-box'}
  automountServiceAccountToken: false
  enableServiceLinks: false
  terminationGracePeriodSeconds: ${f.docker ? 20 : 10}
  nodeSelector:
    devlabs.io/pool: ${f.pool}
  # Fill the always-on base first: boxes are do-not-disrupt, so a box placed on an elastic
  # node keeps that node alive until the box ends.
  affinity:
    nodeAffinity:
      preferredDuringSchedulingIgnoredDuringExecution:
        - weight: 100
          preference:
            matchExpressions:
              - {key: devlabs.io/tier, operator: In, values: [base]}
  tolerations:
    - key: devlabs.io/pool
      value: ${f.pool}
      effect: NoSchedule
  containers:
    - name: ${BOX_CONTAINER}
      image: ${spec.image || f.image}${command}
${securityContext}${readinessProbe}
      resources:
        requests: {cpu: "${res.requests.cpu}", memory: "${res.requests.memory}", ephemeral-storage: ${f.resources.requests.ephemeral}}
        limits: {cpu: "${res.limits.cpu}", memory: "${res.limits.memory}", ephemeral-storage: ${f.resources.limits.ephemeral}}
      volumeMounts:
        - {name: run, mountPath: /run}
        - {name: run-lock, mountPath: /run/lock}
        - {name: tmp, mountPath: /tmp}${dockerMount}
  volumes:
    - name: run
      emptyDir: {medium: Memory, sizeLimit: 64Mi}
    - name: run-lock
      emptyDir: {medium: Memory, sizeLimit: 8Mi}
    - name: tmp
      emptyDir: {sizeLimit: ${f.tmpSize}}${dockerVolume}
`;
}

const ensuredNamespaces = new Set<string>();

async function ensureNamespace(ns: string, flavor: BoxFlavor): Promise<void> {
  if (ensuredNamespaces.has(ns)) return;
  await k8s.kubectlOk(['apply', '-f', '-'], { input: namespaceYaml(ns, flavor), timeoutMs: 30_000 });
  ensuredNamespaces.add(ns);
}

/** Why the box is not Ready, for logs (image pull, unschedulable, crash). */
async function describeNotReady(ns: string): Promise<string> {
  const r = await k8s.runKubectl(
    ['get', 'pod', BOX_POD, '-n', ns, '-o',
      'jsonpath={.status.phase} {.status.conditions[?(@.type=="PodScheduled")].message} {.status.containerStatuses[0].state}'],
    { timeoutMs: 15_000 },
  );
  return (r.stdout || r.stderr || '').trim();
}

/**
 * Boxes are disposable, so they get a 1 s grace period: an open terminal's shell is
 * outside systemd's control and would otherwise hold every delete for the full
 * terminationGracePeriodSeconds.
 */
const DELETE_GRACE_S = '1';

/** Delete any previous box and start a fresh one; resolves once systemd (and dockerd) are up. */
async function recreateBox(ns: string, challengeId: string, flavor: BoxFlavor, spec?: LinuxBoxSpec): Promise<void> {
  await ensureNamespace(ns, flavor);
  await k8s.kubectlOk(
    ['delete', 'pod', BOX_POD, '-n', ns, '--ignore-not-found', `--grace-period=${DELETE_GRACE_S}`,
      '--wait=true', '--timeout=60s'],
    { timeoutMs: 75_000 },
  );
  await k8s.kubectlOk(['apply', '-f', '-'], {
    input: boxPodYaml(ns, challengeId, flavor, spec),
    timeoutMs: 30_000,
  });
  const ready = await k8s.runKubectl(
    ['wait', '--for=condition=Ready', `pod/${BOX_POD}`, '-n', ns, `--timeout=${READY_TIMEOUT_S}s`],
    { timeoutMs: (READY_TIMEOUT_S + 15) * 1000 },
  );
  if (ready.code !== 0) {
    throw new Error(`box not ready after ${READY_TIMEOUT_S}s: ${await describeNotReady(ns)}`);
  }
}

async function deleteBox(ns: string): Promise<void> {
  await k8s.kubectlOk(
    ['delete', 'pod', BOX_POD, '-n', ns, '--ignore-not-found', `--grace-period=${DELETE_GRACE_S}`,
      '--wait=false'],
    { timeoutMs: 30_000 },
  );
}

/** devlabs.io/pool the flavor's boxes are scheduled on. */
function poolFor(flavor: BoxFlavor): string {
  return FLAVORS[flavor].pool;
}

/** Env for setup.sh / grade.sh (see backend/challenges/linux/_lib/lab.sh). */
function scriptEnv(): Record<string, string> {
  return { BOX_POD, BOX_CONTAINER };
}

/**
 * kubectl argv for an interactive login shell as the learner inside the box. Wrapped in a
 * respawn loop so `exit` drops the learner into a fresh login shell instead of ending the
 * exec and stranding the terminal (the frontend doesn't auto-reopen a closed shell). After
 * each exit we overwrite bash's built-in "logout" line with a friendlier note: the login
 * shell is SHLVL 2 (the wrapper is 1), so ~/.bash_logout's clear_console is skipped and the
 * only thing printed is that one "logout" line, which the cursor-up + clear replaces. The
 * loop ends when the pod is deleted or the exec is torn down (TTY SIGHUP). `sleep 1` guards
 * against a hot loop if runuser ever fails to start.
 */
const EXIT_NOTICE = 'This machine stays — Submit to solve the lab. Here is a fresh shell.';

function shellExecArgs(ns: string): string[] {
  const relaunch =
    `while :; do if runuser -l ${LEARNER_USER}; then `
    + `printf '\\033[A\\033[2K\\r\\033[38;5;179m${EXIT_NOTICE}\\033[0m\\n'; `
    + `else sleep 1; fi; done`;
  return ['exec', '-it', '-n', ns, BOX_POD, '-c', BOX_CONTAINER, '--', 'bash', '-c', relaunch];
}

module.exports = {
  BOX_POD,
  LEARNER_USER,
  boxNamespace,
  recreateBox,
  deleteBox,
  poolFor,
  scriptEnv,
  shellExecArgs,
};
