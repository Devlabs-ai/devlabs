'use strict';

/**
 * Isolated containers for the Kubernetes lab terminal.
 *
 * With K8S_LAB_SHELL_MODE=container each terminal gets its own container on
 * the host Docker daemon (image K8S_LAB_SHELL_IMAGE) that only sees:
 *   /home/<user>        — that learner's home (bind from K8S_LAB_HOST_HOME_ROOT)
 *   /run/devlabs-kube   — that namespace's learner kubeconfig, read-only
 * It runs as uid 1000 with a read-only rootfs, no capabilities, and a network
 * that cannot reach private / link-local ranges or the host.
 *
 * Env (container mode):
 *   K8S_LAB_HOST_HOME_ROOT — host path mounted into the backend as K8S_LAB_HOME_ROOT
 *   K8S_LAB_HOST_KUBE_ROOT — host path mounted as K8S_LAB_LEARNER_KUBE_ROOT
 */

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const IMAGE = process.env.K8S_LAB_SHELL_IMAGE || 'devlabs-lab-shell:latest';
const NETWORK = process.env.K8S_LAB_SHELL_NETWORK || 'devlabs_labshell';
const BRIDGE = 'dl-labshell';
const LABEL = 'devlabs.labshell';
const LAB_UID = 1000;
const KUBE_MOUNT = '/run/devlabs-kube';
/** Public resolvers: the VPC resolver sits in a blocked private range. */
const DNS_SERVERS = String(process.env.K8S_LAB_SHELL_DNS || '1.1.1.1,8.8.8.8')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const BLOCKED_CIDRS = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10', '169.254.0.0/16'];

function enabled(): boolean {
  return String(process.env.K8S_LAB_SHELL_MODE || '').trim().toLowerCase() === 'container';
}

function docker(args: string[], timeoutMs = 60_000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile('docker', args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err: any, stdout: string, stderr: string) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

function requireEnv(name: string): string {
  const v = String(process.env[name] || '').trim();
  if (!v) throw new Error(`${name} must be set when K8S_LAB_SHELL_MODE=container`);
  return v;
}

/** Map a path inside the backend container to the same path on the Docker host. */
function toHostPath(localPath: string, localRoot: string, hostRoot: string): string {
  const rel = path.relative(path.resolve(localRoot), path.resolve(localPath));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`${localPath} is outside ${localRoot}`);
  }
  return path.join(hostRoot, rel);
}

function firewallScript(): string {
  const rules: string[] = [];
  for (const cidr of BLOCKED_CIDRS) {
    const spec = `DOCKER-USER -i ${BRIDGE} -d ${cidr} -j DROP`;
    rules.push(`iptables -C ${spec} 2>/dev/null || iptables -I ${spec}`);
  }
  const input = `INPUT -i ${BRIDGE} -j DROP`;
  rules.push(`iptables -C ${input} 2>/dev/null || iptables -I ${input}`);
  return `set -e; ${rules.join('; ')}`;
}

let infraReady: Promise<void> | null = null;

async function setupInfra(): Promise<void> {
  const img = await docker(['image', 'inspect', '--format', '{{.Id}}', IMAGE]);
  if (img.code !== 0) throw new Error(`lab shell image ${IMAGE} not found; build deploy/Dockerfile.labshell`);

  const net = await docker(['network', 'inspect', NETWORK]);
  if (net.code !== 0) {
    const created = await docker([
      'network', 'create', '--driver', 'bridge',
      '--opt', `com.docker.network.bridge.name=${BRIDGE}`,
      '--opt', 'com.docker.network.bridge.enable_icc=false',
      '--label', LABEL,
      NETWORK,
    ]);
    if (created.code !== 0 && !/already exists/.test(created.stderr)) {
      throw new Error(`lab shell network create failed: ${created.stderr.trim()}`);
    }
  }

  const fw = await docker([
    'run', '--rm', '--network', 'host', '--cap-add', 'NET_ADMIN', '--cap-add', 'NET_RAW',
    '--user', '0', '--entrypoint', 'sh', IMAGE, '-c', firewallScript(),
  ]);
  if (fw.code !== 0) throw new Error(`lab shell firewall setup failed: ${(fw.stderr || fw.stdout).trim()}`);
}

function ensureInfra(): Promise<void> {
  if (!infraReady) {
    infraReady = setupInfra().catch((err) => {
      infraReady = null;
      throw err;
    });
  }
  return infraReady;
}

function chownTree(target: string, skipTop: Set<string>): void {
  const st = fs.lstatSync(target);
  if (st.uid !== LAB_UID || st.gid !== LAB_UID) fs.lchownSync(target, LAB_UID, LAB_UID);
  if (!st.isDirectory()) return;
  for (const name of fs.readdirSync(target)) {
    if (skipTop.has(name)) continue;
    chownTree(path.join(target, name), new Set());
  }
}

/** Learner owns their home (except backend-managed .devlabs) and their kubeconfig. */
function prepareOwnership(labHome: string, kubeconfigPath: string): void {
  const kubeDir = path.dirname(kubeconfigPath);
  // Non-root (local Docker Desktop dev): bind mounts are already accessible to uid 1000.
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    chownTree(labHome, new Set(['.devlabs']));
    fs.chownSync(kubeDir, LAB_UID, LAB_UID);
    fs.chownSync(kubeconfigPath, LAB_UID, LAB_UID);
  }
  fs.chmodSync(labHome, 0o700);
  fs.chmodSync(kubeDir, 0o700);
  fs.chmodSync(kubeconfigPath, 0o600);
}

/** Files the backend writes into a learner home must stay editable from the shell container. */
function giveToLearner(target: string): void {
  if (!enabled()) return;
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) return;
  fs.lchownSync(target, LAB_UID, LAB_UID);
}

type StartOpts = {
  sessionId: string;
  userName: string;
  ns: string;
  challengeId: string;
  labHome: string;
  kubeconfigPath: string;
  env: Record<string, string>;
};

/** Start a learner shell container; returns its name for `docker exec`. */
async function startShellContainer(opts: StartOpts): Promise<{ name: string; home: string }> {
  await ensureInfra();

  const hostHome = toHostPath(opts.labHome, requireEnv('K8S_LAB_HOME_ROOT'), requireEnv('K8S_LAB_HOST_HOME_ROOT'));
  const kubeDir = path.dirname(opts.kubeconfigPath);
  const hostKube = toHostPath(kubeDir, requireEnv('K8S_LAB_LEARNER_KUBE_ROOT'), requireEnv('K8S_LAB_HOST_KUBE_ROOT'));
  prepareOwnership(opts.labHome, opts.kubeconfigPath);

  const home = `/home/${opts.userName}`;
  const name = `dl-shell-${opts.userName.slice(0, 32)}-${crypto.randomBytes(4).toString('hex')}`;
  const env: Record<string, string> = {
    ...opts.env,
    HOME: home,
    KUBECONFIG: `${KUBE_MOUNT}/config`,
  };

  const args = [
    'run', '-d', '--name', name,
    '--label', LABEL,
    '--label', `${LABEL}.session=${opts.sessionId}`,
    '--hostname', 'devlabs-lab',
    '--network', NETWORK,
    ...DNS_SERVERS.flatMap((ip) => ['--dns', ip]),
    '--user', `${LAB_UID}:${LAB_UID}`,
    '--read-only',
    '--tmpfs', '/tmp:rw,nosuid,nodev,size=64m,mode=1777',
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges',
    '--pids-limit', '128',
    '--memory', '256m',
    '--memory-swap', '256m',
    '--cpus', '0.5',
    '--mount', `type=bind,src=${hostHome},dst=${home}`,
    '--mount', `type=bind,src=${hostKube},dst=${KUBE_MOUNT},readonly`,
    '--workdir', home,
  ];
  for (const [k, v] of Object.entries(env)) args.push('-e', `${k}=${v}`);
  args.push(IMAGE);

  const res = await docker(args);
  if (res.code !== 0) throw new Error(`lab shell start failed: ${(res.stderr || res.stdout).trim()}`);
  return { name, home };
}

/** Args for node-pty to attach an interactive bash to a started container. */
function execArgs(name: string): string[] {
  return ['exec', '-it', name, '/bin/bash', '--noprofile', '--norc'];
}

function stopShellContainer(name: string): void {
  void docker(['rm', '-f', name], 30_000);
}

/** Remove shell containers whose session is gone (or all of them on boot). */
async function sweepShellContainers(isActive?: (sessionId: string) => boolean): Promise<void> {
  if (!enabled()) return;
  const res = await docker([
    'ps', '-a', '--filter', `label=${LABEL}`,
    '--format', `{{.Names}}\t{{.Label "${LABEL}.session"}}`,
  ]);
  if (res.code !== 0) return;
  const stale = res.stdout
    .split('\n')
    .map((line) => line.split('\t'))
    .filter(([n, sid]) => n && (!isActive || !sid || !isActive(sid)))
    .map(([n]) => n);
  if (stale.length) await docker(['rm', '-f', ...stale], 60_000);
}

module.exports = {
  enabled,
  ensureInfra,
  startShellContainer,
  execArgs,
  stopShellContainer,
  sweepShellContainers,
  giveToLearner,
};
