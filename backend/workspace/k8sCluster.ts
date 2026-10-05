'use strict';

/**
 * kubectl helpers for per-learner Kubernetes labs.
 * Env:
 *   K8S_LAB_KUBECONFIG — kubeconfig path (falls back to KUBECONFIG / default)
 *   K8S_LAB_CONTEXT — optional context name
 *   K8S_LAB_INSECURE_SKIP_TLS_VERIFY=true — local/Colima only when CA is stale
 *   K8S_LAB_HOME_ROOT — learner homes for terminal + challenge snapshots
 *   K8S_LAB_LEARNER_KUBE_ROOT — where minted learner kubeconfigs are cached
 *
 * Isolation: each learner gets Namespace ns-<user> plus a ServiceAccount
 * bound via Role/RoleBinding. Interactive shell + /k8s/exec use a token
 * kubeconfig for that SA (not the controller admin kubeconfig).
 *
 * Session park: on end, every learner-manageable object in the namespace
 * (+ learner-labeled PVs / StorageClasses) is snapshotted under
 *   $K8S_LAB_SNAPSHOT_ROOT/<ns>/<challenge>.json
 * (backend-only; never the learner home), then wiped. Reopen wipes whatever is
 * left, then restores the snapshot (or runs setup.sh if none).
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const workspaceStore = require('./workspaceStore');
const { labPackDir } = require('../challenges/labTypes');

const CHALLENGE_LABEL = 'devlabs.dev/challenge';
/** Cluster-scoped PVs / StorageClasses tagged for a lab namespace. */
const LEARNER_NS_PV_LABEL = 'devlabs.ai/learner-ns';
const LEARNER_STORAGE_CLUSTER_ROLE = 'devlabs-learner-storage';
const SETUP_ANNOTATION_PREFIX = 'devlabs.dev/setup-';
/** Stable names inside each learner namespace (not challenge-labeled → survive wipe). */
const LEARNER_SA = 'devlabs-learner';
const LEARNER_ROLE = 'devlabs-learner';
const LEARNER_ROLEBINDING = 'devlabs-learner';
const LEARNER_TOKEN_DURATION = process.env.K8S_LAB_TOKEN_DURATION || '12h';

/** Skip re-apply of NS platform objects for this long after a successful ensure. */
const PROVISION_CACHE_TTL_MS = Number(process.env.K8S_LAB_PROVISION_CACHE_MS || 30 * 60 * 1000);
/** Refresh learner token this long before expiry. */
const LEARNER_TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;

/**
 * Fallback when a pack omits platformSpec.quota (prefer per-challenge values).
 * Sized as N default containers: requests N×20m/32Mi, limits N×40m/64Mi.
 */
const DEFAULT_QUOTA = {
  pods: '6',
  requests: { cpu: '120m', memory: '192Mi' },
  limits: { cpu: '240m', memory: '384Mi' },
};

/**
 * Fallback LimitRange when a pack omits platformSpec.limitRange. `max` caps any
 * single container (Postgres runs at 100m/128Mi), so one pod cannot eat the node.
 */
const DEFAULT_LIMIT_RANGE = {
  defaultRequest: { cpu: '20m', memory: '32Mi' },
  default: { cpu: '40m', memory: '64Mi' },
  max: { cpu: '100m', memory: '128Mi' },
};

type Resources = { cpu: string; memory: string };
type LabQuota = { pods: string; requests: Resources; limits: Resources };
type LabLimitRange = {
  defaultRequest: Resources;
  default: Resources;
  max?: { cpu?: string; memory?: string };
  min?: { cpu?: string; memory?: string };
};

/** Pack quota. Legacy cpu/memory set requests and limits to the same value. */
export type LabQuotaSpec = {
  pods?: string;
  cpu?: string;
  memory?: string;
  requests?: { cpu?: string; memory?: string };
  limits?: { cpu?: string; memory?: string };
};

export type EnsureLearnerNamespaceOpts = {
  quota?: LabQuotaSpec;
  limitRange?: {
    defaultRequest?: { cpu?: string; memory?: string };
    default?: { cpu?: string; memory?: string };
    max?: { cpu?: string; memory?: string };
    min?: { cpu?: string; memory?: string };
  };
  /**
   * When false, only ensure Namespace + learner SA/RBAC exist.
   * Does not touch ResourceQuota / LimitRange (avoids resetting challenge
   * quotas on terminal kubeconfig mint). Default true.
   */
  reconcileLimits?: boolean;
};

/** ns → last successful ensureLearnerNamespace (ms). */
const provisionedNsAt = new Map<string, number>();
/** ns → cached learner kubeconfig path + expiry. */
const learnerKubeCache = new Map<string, { path: string; expiresAt: number }>();
/** Process-lifetime cluster endpoint from controller kubeconfig (avoids repeated config view). */
let cachedClusterEndpoint:
  | {
      server: string;
      caData: string | null;
      skipTls: boolean;
    }
  | null = null;
/** ns → challengeId → setup done (avoids repeated get ns). */
const setupDoneCache = new Map<string, Map<string, boolean>>();

const LEARNER_KUBE_CACHE_ROOT =
  String(process.env.K8S_LAB_LEARNER_KUBE_ROOT || '').trim()
  || path.join(os.tmpdir(), 'dl-k8s-learner-cache');

/** Snapshots are restored with elevated rights, so they must live where learners cannot write. */
const SNAPSHOT_ROOT =
  String(process.env.K8S_LAB_SNAPSHOT_ROOT || '').trim()
  || path.join(os.homedir(), '.devlabs', 'k8s-snapshots');

/**
 * Namespaced resources learners may manage, by API group. Single source for the
 * learner Role, park snapshots and wipes, so anything a learner can create is
 * also saved with its lab and removed before the next one.
 */
const LEARNER_API_GROUPS: Record<string, string[]> = {
  '': [
    'pods',
    'services',
    'endpoints',
    'configmaps',
    'secrets',
    'persistentvolumeclaims',
    'serviceaccounts',
    'replicationcontrollers',
  ],
  apps: ['deployments', 'statefulsets', 'daemonsets', 'replicasets'],
  batch: ['jobs', 'cronjobs'],
  autoscaling: ['horizontalpodautoscalers'],
  policy: ['poddisruptionbudgets'],
  'networking.k8s.io': ['ingresses', 'networkpolicies'],
  'rbac.authorization.k8s.io': ['roles', 'rolebindings'],
  'snapshot.storage.k8s.io': ['volumesnapshots'],
  'autoscaling.k8s.io': ['verticalpodautoscalers'],
  'security.istio.io': ['peerauthentications', 'authorizationpolicies'],
  'networking.istio.io': ['destinationrules', 'virtualservices'],
};

/** Controllers own these; they are wiped but never snapshotted. */
const DERIVED_RESOURCES = new Set(['endpoints']);

const LEARNER_VERBS = ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete', 'deletecollection'];
const READ_VERBS = ['get', 'list', 'watch'];

const PSA_LEVEL = process.env.K8S_LAB_POD_SECURITY || 'baseline';

function parseDurationMs(raw: string): number {
  const s = String(raw || '').trim();
  const m = /^(\d+)(h|m|s)?$/i.exec(s);
  if (!m) return 12 * 60 * 60 * 1000;
  const n = Number(m[1]);
  const unit = (m[2] || 's').toLowerCase();
  if (unit === 'h') return n * 60 * 60 * 1000;
  if (unit === 'm') return n * 60 * 1000;
  return n * 1000;
}

function invalidateNsCaches(ns: string): void {
  provisionedNsAt.delete(ns);
  setupDoneCache.delete(ns);
  const cached = learnerKubeCache.get(ns);
  if (cached) {
    learnerKubeCache.delete(ns);
    try {
      fs.rmSync(path.dirname(cached.path), { recursive: true, force: true });
    } catch (_e) {
      /* ignore */
    }
  }
}

function isProvisionCached(ns: string): boolean {
  const at = provisionedNsAt.get(ns);
  if (!at) return false;
  return Date.now() - at < PROVISION_CACHE_TTL_MS;
}

function markProvisionCached(ns: string): void {
  provisionedNsAt.set(ns, Date.now());
}

/** Cached EKS IAM token so kubectl skips `aws eks get-token` on every call. */
let controllerIamToken: { token: string; expiresAt: number } | null = null;
let controllerIamTokenInflight: Promise<string> | null = null;
/** Parsed once from controller kubeconfig exec args. */
let eksExecHint: { cluster: string; region: string } | null | undefined;

function spawnCapture(
  cmd: string,
  args: string[],
  opts: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      env: opts.env || process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${cmd} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function readEksExecHintFromKubeconfig(): { cluster: string; region: string } | null {
  if (eksExecHint !== undefined) return eksExecHint;
  const cfgPath = process.env.K8S_LAB_KUBECONFIG || process.env.KUBECONFIG;
  const envCluster = process.env.K8S_LAB_EKS_CLUSTER || process.env.EKS_CLUSTER_NAME;
  const envRegion = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  if (envCluster && envRegion) {
    eksExecHint = { cluster: envCluster, region: envRegion };
    return eksExecHint;
  }
  if (!cfgPath || !fs.existsSync(cfgPath)) {
    eksExecHint = null;
    return null;
  }
  try {
    const raw = fs.readFileSync(cfgPath, 'utf8');
    // aws eks update-kubeconfig writes: args: [..., "eks", "get-token", "--cluster-name", NAME, ...]
    // Matches `--flag value`, `--flag=value`, YAML list items on separate lines, and JSON arrays.
    const clusterMatch = /--cluster-name["']?(?:=|[\s,]+(?:-\s+)?)["']?([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(raw);
    const regionMatch = /--region["']?(?:=|[\s,]+(?:-\s+)?)["']?([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(raw);
    const cluster = envCluster || clusterMatch?.[1] || null;
    const region = envRegion || regionMatch?.[1] || null;
    eksExecHint = cluster && region ? { cluster, region } : null;
  } catch {
    eksExecHint = null;
  }
  return eksExecHint;
}

async function getControllerIamToken(): Promise<string | null> {
  const hint = readEksExecHintFromKubeconfig();
  if (!hint) return null;

  const now = Date.now();
  if (controllerIamToken && controllerIamToken.expiresAt - LEARNER_TOKEN_REFRESH_SKEW_MS > now) {
    return controllerIamToken.token;
  }
  if (controllerIamTokenInflight) return controllerIamTokenInflight;

  controllerIamTokenInflight = (async () => {
    const r = await spawnCapture(
      'aws',
      [
        'eks',
        'get-token',
        '--cluster-name',
        hint.cluster,
        '--region',
        hint.region,
        '--output',
        'json',
      ],
      { timeoutMs: 20_000, env: kubectlEnv() },
    );
    if (r.code !== 0) {
      throw Object.assign(
        new Error((r.stderr || r.stdout || 'aws eks get-token failed').trim()),
        { status: 502 },
      );
    }
    const doc = JSON.parse(r.stdout) as {
      status?: { token?: string; expirationTimestamp?: string };
    };
    const token = doc.status?.token;
    if (!token) {
      throw Object.assign(new Error('aws eks get-token returned no token'), { status: 502 });
    }
    const expRaw = doc.status?.expirationTimestamp;
    const expiresAt = expRaw ? Date.parse(expRaw) : now + 14 * 60 * 1000;
    controllerIamToken = { token, expiresAt: Number.isFinite(expiresAt) ? expiresAt : now + 14 * 60 * 1000 };
    return token;
  })();

  try {
    return await controllerIamTokenInflight;
  } finally {
    controllerIamTokenInflight = null;
  }
}

let controllerTokenWarned = false;

/** Without a cached token every kubectl call execs `aws eks get-token` (~1s each). */
function warnControllerTokenOnce(err: Error): void {
  if (controllerTokenWarned) return;
  controllerTokenWarned = true;
  console.warn(`[k8s] cached EKS token unavailable, falling back to kubeconfig exec auth: ${err.message}`);
}

/** Default lab namespace: ns-<user-name> (DNS-1123, max 63). */
function learnerNamespace(userName: string): string {
  const owner = workspaceStore.sanitizeOwner(userName || 'anonymous').toLowerCase();
  const base = `ns-${owner}`.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
  return base.slice(0, 63).replace(/-$/, '') || 'ns-anonymous';
}

/**
 * Annotation key for "setup done" on the learner Namespace.
 * K8s requires the name part (after optional prefix/) to start and end with
 * alphanumeric — truncating challenge ids must not leave a trailing '-'.
 */
function setupAnnotationKey(challengeId: string): string {
  let safe = (challengeId || 'unknown')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/^[^a-zA-Z0-9]+/, '')
    .slice(0, 40)
    .replace(/[^a-zA-Z0-9]+$/g, '');
  if (!safe) safe = 'lab';
  return `${SETUP_ANNOTATION_PREFIX}${safe}`;
}

function kubectlEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const cfg = process.env.K8S_LAB_KUBECONFIG || process.env.KUBECONFIG;
  if (cfg) {
    env.KUBECONFIG = cfg;
  }
  return env;
}

function kubectlBaseArgs(): string[] {
  const args: string[] = [];
  if (process.env.K8S_LAB_CONTEXT) {
    args.push('--context', process.env.K8S_LAB_CONTEXT);
  }
  const skip = String(process.env.K8S_LAB_INSECURE_SKIP_TLS_VERIFY || '').toLowerCase();
  if (skip === '1' || skip === 'true' || skip === 'yes') {
    args.push('--insecure-skip-tls-verify=true');
  }
  return args;
}

export type KubectlResult = {
  code: number;
  stdout: string;
  stderr: string;
};

function runKubectl(
  args: string[],
  opts: { timeoutMs?: number; input?: string; learnerKubeconfig?: string } = {},
): Promise<KubectlResult> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  return (async () => {
    let fullArgs: string[];
    let env: NodeJS.ProcessEnv;
    if (opts.learnerKubeconfig) {
      fullArgs = ['--kubeconfig', opts.learnerKubeconfig, ...args];
      env = { ...process.env };
      delete env.KUBECONFIG;
    } else {
      const token = await getControllerIamToken().catch((err: Error) => {
        warnControllerTokenOnce(err);
        return null;
      });
      fullArgs = [
        ...kubectlBaseArgs(),
        ...(token ? ['--token', token] : []),
        ...args,
      ];
      env = kubectlEnv();
    }
    return new Promise<KubectlResult>((resolve, reject) => {
      const child = spawn('kubectl', fullArgs, {
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(Object.assign(new Error(`kubectl timed out after ${timeoutMs}ms`), { status: 504 }));
      }, timeoutMs);
      child.stdout.on('data', (d: Buffer) => {
        stdout += d.toString();
      });
      child.stderr.on('data', (d: Buffer) => {
        stderr += d.toString();
      });
      child.on('error', (err: Error) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on('close', (code: number | null) => {
        clearTimeout(timer);
        resolve({ code: code ?? 1, stdout, stderr });
      });
      if (opts.input != null) {
        child.stdin.write(opts.input);
      }
      child.stdin.end();
    });
  })();
}

/** Controller-credential kubectl argv + env, for callers that spawn kubectl themselves (PTY). */
async function controllerKubectlCommand(
  args: string[],
): Promise<{ args: string[]; env: NodeJS.ProcessEnv }> {
  const token = await getControllerIamToken().catch((err: Error) => {
    warnControllerTokenOnce(err);
    return null;
  });
  return {
    args: [...kubectlBaseArgs(), ...(token ? ['--token', token] : []), ...args],
    env: kubectlEnv(),
  };
}

async function kubectlOk(
  args: string[],
  opts?: { timeoutMs?: number; input?: string; learnerKubeconfig?: string },
): Promise<string> {
  const r = await runKubectl(args, opts);
  if (r.code !== 0) {
    const msg = (r.stderr || r.stdout || `kubectl exit ${r.code}`).trim();
    throw Object.assign(new Error(msg), { status: 502, kubectl: r });
  }
  return r.stdout;
}

async function namespaceExists(ns: string): Promise<boolean> {
  const r = await runKubectl(['get', 'ns', ns, '-o', 'name']);
  return r.code === 0;
}

/**
 * Namespaced Role + read-only cluster visibility for CKAD-style labs
 * (StorageClasses, PVs, Nodes, VolumeSnapshotClasses — scheduling / storage labs).
 */
function yamlList(items: string[]): string {
  return `[${items.map((i) => JSON.stringify(i)).join(', ')}]`;
}

/**
 * Explicit resources and verbs only: no "*" on core (would cover the Namespace
 * object itself and quota/limits) and no bind/escalate/impersonate, so learners
 * cannot grant themselves more than this Role.
 */
function learnerRoleRulesYaml(): string {
  const rules: string[] = [];
  const rule = (groups: string[], resources: string[], verbs: string[]): void => {
    rules.push(
      `  - apiGroups: ${yamlList(groups)}\n    resources: ${yamlList(resources)}\n    verbs: ${yamlList(verbs)}`,
    );
  };
  rule([''], [
    ...LEARNER_API_GROUPS[''],
    'pods/log',
    'pods/exec',
    'pods/portforward',
    'pods/attach',
    'pods/ephemeralcontainers',
    'pods/eviction',
    'serviceaccounts/token',
    'replicationcontrollers/scale',
  ], LEARNER_VERBS);
  rule([''], ['resourcequotas', 'limitranges', 'namespaces', 'events'], READ_VERBS);
  for (const [group, resources] of Object.entries(LEARNER_API_GROUPS)) {
    if (!group) continue;
    const withSub = resources.flatMap((r) =>
      ['deployments', 'statefulsets', 'replicasets'].includes(r) ? [r, `${r}/scale`] : [r],
    );
    rule([group], withSub, LEARNER_VERBS);
  }
  rule(['events.k8s.io', 'metrics.k8s.io'], ['*'], READ_VERBS);
  return rules.join('\n');
}

function learnerRbacYaml(ns: string): string {
  const storageBinding = `${LEARNER_STORAGE_CLUSTER_ROLE}-${ns}`;
  return `
apiVersion: v1
kind: Namespace
metadata:
  name: ${ns}
  labels:
    pod-security.kubernetes.io/enforce: ${PSA_LEVEL}
    pod-security.kubernetes.io/enforce-version: latest
    pod-security.kubernetes.io/warn: ${PSA_LEVEL}
    pod-security.kubernetes.io/warn-version: latest
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: ${LEARNER_SA}
  namespace: ${ns}
  labels:
    app.kubernetes.io/managed-by: devlabs
    app.kubernetes.io/component: learner-rbac
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: ${LEARNER_ROLE}
  namespace: ${ns}
  labels:
    app.kubernetes.io/managed-by: devlabs
    app.kubernetes.io/component: learner-rbac
rules:
${learnerRoleRulesYaml()}
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: ${LEARNER_ROLEBINDING}
  namespace: ${ns}
  labels:
    app.kubernetes.io/managed-by: devlabs
    app.kubernetes.io/component: learner-rbac
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: ${LEARNER_ROLE}
subjects:
  - kind: ServiceAccount
    name: ${LEARNER_SA}
    namespace: ${ns}
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: ${LEARNER_STORAGE_CLUSTER_ROLE}
  labels:
    app.kubernetes.io/managed-by: devlabs
    app.kubernetes.io/component: learner-rbac
rules:
  - apiGroups: ["storage.k8s.io"]
    resources: ["storageclasses"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["snapshot.storage.k8s.io"]
    resources: ["volumesnapshotclasses"]
    verbs: ["get", "list", "watch"]
  - apiGroups: [""]
    resources: ["persistentvolumes", "nodes"]
    verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: ${storageBinding}
  labels:
    app.kubernetes.io/managed-by: devlabs
    app.kubernetes.io/component: learner-rbac
    ${LEARNER_NS_PV_LABEL}: ${ns}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: ${LEARNER_STORAGE_CLUSTER_ROLE}
subjects:
  - kind: ServiceAccount
    name: ${LEARNER_SA}
    namespace: ${ns}
`;
}

async function ensureLearnerRbac(ns: string): Promise<void> {
  await kubectlOk(['apply', '-f', '-'], { input: learnerRbacYaml(ns) });
  // Drop prior mutate grants (create/update/delete SC) if an older DevSetu revision
  // installed them — learners are read-only on cluster-scoped storage now.
  const mutateRole = `${LEARNER_STORAGE_CLUSTER_ROLE}-mutate-${ns}`;
  await runKubectl(['delete', 'clusterrole', mutateRole, '--ignore-not-found'], {
    timeoutMs: 30_000,
  });
  await runKubectl(['delete', 'clusterrolebinding', mutateRole, '--ignore-not-found'], {
    timeoutMs: 30_000,
  });
}

async function learnerPlatformReady(ns: string): Promise<boolean> {
  const r = await runKubectl(['get', 'sa', LEARNER_SA, '-n', ns, '-o', 'name']);
  return r.code === 0;
}

function mergeQuota(partial?: LabQuotaSpec): LabQuota {
  const pick = (kind: 'requests' | 'limits', r: 'cpu' | 'memory'): string =>
    partial?.[kind]?.[r] || partial?.[r] || DEFAULT_QUOTA[kind][r];
  return {
    pods: partial?.pods || DEFAULT_QUOTA.pods,
    requests: { cpu: pick('requests', 'cpu'), memory: pick('requests', 'memory') },
    limits: { cpu: pick('limits', 'cpu'), memory: pick('limits', 'memory') },
  };
}

function stripEmpty(r?: { cpu?: string; memory?: string }): { cpu?: string; memory?: string } {
  const out: { cpu?: string; memory?: string } = {};
  if (r?.cpu) out.cpu = r.cpu;
  if (r?.memory) out.memory = r.memory;
  return out;
}

function mergeLimitRange(
  partial?: EnsureLearnerNamespaceOpts['limitRange'],
): LabLimitRange {
  const lr: LabLimitRange = {
    defaultRequest: {
      cpu: partial?.defaultRequest?.cpu || DEFAULT_LIMIT_RANGE.defaultRequest.cpu,
      memory: partial?.defaultRequest?.memory || DEFAULT_LIMIT_RANGE.defaultRequest.memory,
    },
    default: {
      cpu: partial?.default?.cpu || DEFAULT_LIMIT_RANGE.default.cpu,
      memory: partial?.default?.memory || DEFAULT_LIMIT_RANGE.default.memory,
    },
    max: { ...DEFAULT_LIMIT_RANGE.max, ...stripEmpty(partial?.max) },
  };
  if (partial?.min && (partial.min.cpu || partial.min.memory)) {
    lr.min = { ...partial.min };
  }
  return lr;
}

function limitRangeYamlBlock(lr: LabLimitRange): string {
  const lines = [
    '    - type: Container',
    '      defaultRequest:',
    `        cpu: ${lr.defaultRequest.cpu}`,
    `        memory: ${lr.defaultRequest.memory}`,
    '      default:',
    `        cpu: ${lr.default.cpu}`,
    `        memory: ${lr.default.memory}`,
  ];
  if (lr.max && (lr.max.cpu || lr.max.memory)) {
    lines.push('      max:');
    if (lr.max.cpu) lines.push(`        cpu: ${lr.max.cpu}`);
    if (lr.max.memory) lines.push(`        memory: ${lr.max.memory}`);
  }
  if (lr.min && (lr.min.cpu || lr.min.memory)) {
    lines.push('      min:');
    if (lr.min.cpu) lines.push(`        cpu: ${lr.min.cpu}`);
    if (lr.min.memory) lines.push(`        memory: ${lr.min.memory}`);
  }
  return lines.join('\n');
}

function platformObjectsYaml(ns: string, q: LabQuota, lr: LabLimitRange): string {
  return `
apiVersion: v1
kind: ResourceQuota
metadata:
  name: dl-lab-quota
  namespace: ${ns}
  labels:
    app.kubernetes.io/managed-by: devlabs
spec:
  hard:
    pods: "${q.pods}"
    requests.cpu: "${q.requests.cpu}"
    requests.memory: "${q.requests.memory}"
    limits.cpu: "${q.limits.cpu}"
    limits.memory: "${q.limits.memory}"
---
apiVersion: v1
kind: LimitRange
metadata:
  name: dl-lab-limits
  namespace: ${ns}
  labels:
    app.kubernetes.io/managed-by: devlabs
spec:
  limits:
${limitRangeYamlBlock(lr)}
---
${learnerRbacYaml(ns)}
`;
}

async function ensureNamespaceExists(ns: string): Promise<void> {
  if (await namespaceExists(ns)) return;
  const created = await runKubectl(['create', 'namespace', ns]);
  if (created.code !== 0 && !/AlreadyExists/i.test(created.stderr || '')) {
    throw Object.assign(new Error((created.stderr || created.stdout || 'create ns failed').trim()), {
      status: 502,
    });
  }
}

/**
 * Ensure learner Namespace exists and apply platform ResourceQuota + LimitRange + RBAC.
 * Pass reconcileLimits:false from kubeconfig mint so challenge quotas are not reset.
 */
async function ensureLearnerNamespace(
  ns: string,
  opts: EnsureLearnerNamespaceOpts | LabQuotaSpec = {},
): Promise<void> {
  // Back-compat: callers that passed a bare quota object still work.
  const normalized: EnsureLearnerNamespaceOpts =
    opts && ('quota' in opts || 'limitRange' in opts || 'reconcileLimits' in opts)
      ? (opts as EnsureLearnerNamespaceOpts)
      : { quota: opts as LabQuotaSpec };

  const reconcileLimits = normalized.reconcileLimits !== false;

  await ensureNamespaceExists(ns);

  if (!reconcileLimits) {
    // Terminal reconnect: SA must exist, but do not overwrite quota/LimitRange.
    await ensureLearnerRbac(ns);
    return;
  }

  const q = mergeQuota(normalized.quota);
  const lr = mergeLimitRange(normalized.limitRange);
  // Always reconcile quota + LimitRange on lab open so challenge switches pick up
  // the new pack ceilings (warm-path skip previously froze bad LimitRange defaults).
  await kubectlOk(['apply', '-f', '-'], { input: platformObjectsYaml(ns, q, lr) });
  markProvisionCached(ns);
}

async function resolveClusterEndpoint(): Promise<{
  server: string;
  caData: string | null;
  skipTls: boolean;
}> {
  if (cachedClusterEndpoint) return cachedClusterEndpoint;

  // Prefer reading kubeconfig from disk (no aws get-token / API round-trip).
  const cfgPath = process.env.K8S_LAB_KUBECONFIG || process.env.KUBECONFIG;
  let doc: {
    clusters?: Array<{
      name?: string;
      cluster?: {
        server?: string;
        'certificate-authority-data'?: string;
        'insecure-skip-tls-verify'?: boolean;
      };
    }>;
  };
  if (cfgPath && fs.existsSync(cfgPath)) {
    const raw = fs.readFileSync(cfgPath, 'utf8');
    // YAML is fine for our narrow fields; fall back to kubectl if parse is awkward.
    // Prefer JSON via a tiny regex / kubectl when file is YAML from aws update-kubeconfig.
    try {
      // aws eks kubeconfigs are YAML; extract with kubectl only if needed.
      const serverMatch = /^\s*server:\s*(\S+)\s*$/m.exec(raw);
      const caMatch = /^\s*certificate-authority-data:\s*(\S+)\s*$/m.exec(raw);
      const skipMatch = /^\s*insecure-skip-tls-verify:\s*(true|false)\s*$/m.exec(raw);
      if (serverMatch) {
        const skipEnv = String(process.env.K8S_LAB_INSECURE_SKIP_TLS_VERIFY || '').toLowerCase();
        const skipTls =
          skipEnv === '1'
          || skipEnv === 'true'
          || skipEnv === 'yes'
          || skipMatch?.[1] === 'true';
        cachedClusterEndpoint = {
          server: serverMatch[1],
          caData: caMatch?.[1] || null,
          skipTls,
        };
        return cachedClusterEndpoint;
      }
    } catch {
      /* fall through */
    }
  }

  const view = await runKubectl(['config', 'view', '--minify', '--raw', '-o', 'json']);
  if (view.code !== 0) {
    throw Object.assign(new Error((view.stderr || 'config view failed').trim()), { status: 502 });
  }
  doc = JSON.parse(view.stdout) as typeof doc;
  const cluster = doc.clusters?.[0]?.cluster;
  const server = cluster?.server;
  if (!server) {
    throw Object.assign(new Error('could not resolve cluster server from kubeconfig'), { status: 502 });
  }

  const skipEnv = String(process.env.K8S_LAB_INSECURE_SKIP_TLS_VERIFY || '').toLowerCase();
  const skipTls =
    skipEnv === '1'
    || skipEnv === 'true'
    || skipEnv === 'yes'
    || cluster?.['insecure-skip-tls-verify'] === true;

  cachedClusterEndpoint = {
    server,
    caData: cluster?.['certificate-authority-data'] || null,
    skipTls,
  };
  return cachedClusterEndpoint;
}

/**
 * Build a short-lived kubeconfig authenticating as the learner SA in `ns`.
 * Cached until near token expiry so terminal reconnects skip minting.
 */
async function createLearnerKubeconfig(ns: string): Promise<string> {
  const now = Date.now();
  const cached = learnerKubeCache.get(ns);
  if (
    cached
    && cached.expiresAt - LEARNER_TOKEN_REFRESH_SKEW_MS > now
    && fs.existsSync(cached.path)
  ) {
    // After EKS recreate the API server hostname changes; drop stale mint.
    try {
      const live = await resolveClusterEndpoint();
      const raw = fs.readFileSync(cached.path, 'utf8');
      const m = /^\s*server:\s*(\S+)\s*$/m.exec(raw);
      if (m && m[1] === live.server) return cached.path;
    } catch {
      /* remint below */
    }
    learnerKubeCache.delete(ns);
    try {
      fs.rmSync(path.dirname(cached.path), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }

  // Ensure SA exists without resetting challenge ResourceQuota / LimitRange. Skipped
  // right after a full reconcile (same RBAC); revokeLearnerAccess clears that cache.
  if (!isProvisionCached(ns)) await ensureLearnerNamespace(ns, { reconcileLimits: false });

  // Mint SA token and resolve cluster endpoint in parallel (endpoint is process-cached after first).
  const [tokenResult, cluster] = await Promise.all([
    runKubectl([
      'create',
      'token',
      LEARNER_SA,
      '-n',
      ns,
      `--duration=${LEARNER_TOKEN_DURATION}`,
    ]),
    resolveClusterEndpoint(),
  ]);
  if (tokenResult.code !== 0) {
    const msg = (tokenResult.stderr || tokenResult.stdout || 'create token failed').trim();
    throw Object.assign(new Error(msg), { status: 502 });
  }
  const token = tokenResult.stdout.trim();
  if (!token) {
    throw Object.assign(new Error('empty service account token'), { status: 502 });
  }

  let clusterBlock: string;
  if (cluster.skipTls || !cluster.caData) {
    clusterBlock = `  cluster:
    server: ${cluster.server}
    insecure-skip-tls-verify: true`;
  } else {
    clusterBlock = `  cluster:
    server: ${cluster.server}
    certificate-authority-data: ${cluster.caData}`;
  }

  const kubeconfig = `apiVersion: v1
kind: Config
clusters:
- name: devlabs-lab
${clusterBlock}
users:
- name: learner
  user:
    token: ${token}
contexts:
- name: learner
  context:
    cluster: devlabs-lab
    namespace: ${ns}
    user: learner
current-context: learner
`;

  const dir = path.join(LEARNER_KUBE_CACHE_ROOT, ns);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const dest = path.join(dir, 'config');
  fs.writeFileSync(dest, kubeconfig, { mode: 0o600 });

  const ttlMs = parseDurationMs(LEARNER_TOKEN_DURATION);
  const expiresAt = now + ttlMs;
  // Drop previous file if path differed (same path here).
  learnerKubeCache.set(ns, { path: dest, expiresAt });
  return dest;
}

function removeLearnerKubeconfig(kubeconfigPath: string): void {
  // Cached learner configs are reused across terminal reconnects — do not delete.
  if (
    kubeconfigPath
    && path.normalize(kubeconfigPath).startsWith(path.normalize(LEARNER_KUBE_CACHE_ROOT) + path.sep)
  ) {
    return;
  }
  try {
    fs.rmSync(path.dirname(kubeconfigPath), { recursive: true, force: true });
  } catch (_e) {
    /* ignore */
  }
}

async function hasChallengeSetup(ns: string, challengeId: string): Promise<boolean> {
  const byNs = setupDoneCache.get(ns);
  if (byNs && byNs.has(challengeId)) return Boolean(byNs.get(challengeId));

  const key = setupAnnotationKey(challengeId);
  const raw = await runKubectl(['get', 'ns', ns, '-o', 'json']);
  if (raw.code !== 0) return false;
  try {
    const doc = JSON.parse(raw.stdout) as {
      metadata?: { annotations?: Record<string, string> };
    };
    const ok = doc.metadata?.annotations?.[key] === '1';
    if (!setupDoneCache.has(ns)) setupDoneCache.set(ns, new Map());
    setupDoneCache.get(ns)!.set(challengeId, ok);
    return ok;
  } catch {
    return false;
  }
}

async function markChallengeSetup(ns: string, challengeId: string): Promise<void> {
  const key = setupAnnotationKey(challengeId);
  await kubectlOk(['annotate', 'ns', ns, `${key}=1`, '--overwrite']);
  if (!setupDoneCache.has(ns)) setupDoneCache.set(ns, new Map());
  setupDoneCache.get(ns)!.set(challengeId, true);
}

async function clearChallengeSetup(ns: string, challengeId: string): Promise<void> {
  const key = setupAnnotationKey(challengeId);
  await runKubectl(['annotate', 'ns', ns, `${key}-`]);
  setupDoneCache.get(ns)?.delete(challengeId);
}

function learnerUserNameFromNs(ns: string): string {
  if (ns.startsWith('ns-') && ns.length > 3) return ns.slice(3);
  return ns || 'learner';
}

function defaultHomeRoot(): string {
  const fromEnv = String(process.env.K8S_LAB_HOME_ROOT || '').trim();
  if (fromEnv) return fromEnv;
  return process.platform === 'darwin' ? '/Users' : '/home';
}

/** Same home resolution as the K8s terminal PTY. */
function resolveLearnerHome(ns: string): string {
  const userName = learnerUserNameFromNs(ns);
  const preferred = path.join(defaultHomeRoot(), userName);
  try {
    fs.mkdirSync(preferred, { recursive: true, mode: 0o700 });
    fs.accessSync(preferred, fs.constants.W_OK);
    return preferred;
  } catch {
    const fallback = path.join(os.homedir(), 'devlabs-homes', userName);
    fs.mkdirSync(fallback, { recursive: true, mode: 0o700 });
    return fallback;
  }
}

function snapshotSafeName(challengeId: string): string {
  return (challengeId || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
}

function snapshotFilePath(ns: string, challengeId: string): string {
  return path.join(SNAPSHOT_ROOT, ns.replace(/[^a-z0-9-]/g, '_'), `${snapshotSafeName(challengeId)}.json`);
}

/** Pre-move location inside the learner home; learner-writable, so only read once through vetting. */
function legacySnapshotFilePath(ns: string, challengeId: string): string {
  return path.join(resolveLearnerHome(ns), '.devlabs', 'k8s-snapshots', `${snapshotSafeName(challengeId)}.json`);
}

type K8sObject = {
  apiVersion?: string;
  kind?: string;
  metadata?: {
    name?: string;
    namespace?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    ownerReferences?: unknown[];
    resourceVersion?: string;
    uid?: string;
    generation?: number;
    creationTimestamp?: string;
    deletionTimestamp?: string;
    managedFields?: unknown;
    selfLink?: string;
    [key: string]: unknown;
  };
  spec?: Record<string, unknown>;
  data?: unknown;
  stringData?: unknown;
  type?: string;
  status?: unknown;
  [key: string]: unknown;
};

type LearnerKind = { ref: string; resource: string; group: string };
let learnerKindsCache: { at: number; kinds: LearnerKind[] } | null = null;
const LEARNER_KINDS_TTL_MS = 10 * 60 * 1000;

/** LEARNER_API_GROUPS entries this cluster actually serves (Istio / VPA CRDs are optional). */
async function learnerKinds(): Promise<LearnerKind[]> {
  if (learnerKindsCache && Date.now() - learnerKindsCache.at < LEARNER_KINDS_TTL_MS) {
    return learnerKindsCache.kinds;
  }
  const r = await runKubectl(
    ['api-resources', '--namespaced=true', '--verbs=list,delete', '-o', 'name'],
    { timeoutMs: 45_000 },
  );
  // An unavailable aggregated API makes discovery exit non-zero but still lists the rest.
  if (!r.stdout.trim()) {
    throw Object.assign(new Error(`api discovery failed: ${(r.stderr || 'no output').trim()}`), { status: 502 });
  }
  const kinds: LearnerKind[] = [];
  for (const line of r.stdout.split('\n')) {
    const ref = line.trim();
    if (!ref) continue;
    const dot = ref.indexOf('.');
    const resource = dot === -1 ? ref : ref.slice(0, dot);
    const group = dot === -1 ? '' : ref.slice(dot + 1);
    if (LEARNER_API_GROUPS[group]?.includes(resource)) kinds.push({ ref, resource, group });
  }
  learnerKindsCache = { at: Date.now(), kinds };
  return kinds;
}

function groupOf(apiVersion: string | undefined): string {
  const v = String(apiVersion || '');
  return v.includes('/') ? v.slice(0, v.indexOf('/')) : '';
}

function pluralOf(kind: string): string {
  const k = kind.toLowerCase();
  if (k === 'endpoints') return k;
  if (k.endsWith('y')) return `${k.slice(0, -1)}ies`;
  if (k.endsWith('s')) return `${k}es`;
  return `${k}s`;
}

function isLearnerManaged(obj: K8sObject): boolean {
  const resource = pluralOf(obj.kind || '');
  return Boolean(LEARNER_API_GROUPS[groupOf(obj.apiVersion)]?.includes(resource));
}

/** DevSetu-owned objects inside the learner namespace; never saved, never wiped. */
function isPlatformObject(obj: K8sObject): boolean {
  const name = obj.metadata?.name || '';
  const kind = (obj.kind || '').toLowerCase();
  if (!name) return true;
  if (kind === 'serviceaccount' && (name === LEARNER_SA || name === 'default')) return true;
  if (kind === 'role' && name === LEARNER_ROLE) return true;
  if (kind === 'rolebinding' && name === LEARNER_ROLEBINDING) return true;
  if (kind === 'configmap' && name === 'kube-root-ca.crt') return true;
  if (kind === 'secret' && obj.type === 'kubernetes.io/service-account-token') return true;
  return false;
}

function shouldSkipSnapshotObject(obj: K8sObject): boolean {
  if (isPlatformObject(obj)) return true;
  if (DERIVED_RESOURCES.has(pluralOf(obj.kind || ''))) return true;
  if (obj.metadata?.deletionTimestamp) return true;
  // Children a controller recreates (a Deployment's ReplicaSets and Pods, a CronJob's Jobs).
  // Bare ReplicaSets / Pods have no owner and are kept.
  const owners = obj.metadata?.ownerReferences;
  return Array.isArray(owners) && owners.length > 0;
}

const BINDING_ANNOTATION_PREFIXES = ['pv.kubernetes.io/', 'volume.kubernetes.io/', 'volume.beta.kubernetes.io/'];
const JOB_GENERATED_LABELS = ['controller-uid', 'batch.kubernetes.io/controller-uid', 'job-name', 'batch.kubernetes.io/job-name'];

function sanitizeForReapply(obj: K8sObject, ns: string): K8sObject | null {
  if (shouldSkipSnapshotObject(obj)) return null;
  const copy: K8sObject = JSON.parse(JSON.stringify(obj));
  delete copy.status;
  const md = copy.metadata || {};
  delete md.resourceVersion;
  delete md.uid;
  delete md.generation;
  delete md.creationTimestamp;
  delete md.deletionTimestamp;
  delete md.managedFields;
  delete md.selfLink;
  delete md.ownerReferences;
  const kind = (copy.kind || '').toLowerCase();
  // PersistentVolumes / StorageClasses are cluster-scoped — never assign a namespace.
  if (kind === 'persistentvolume' || kind === 'storageclass') {
    delete md.namespace;
    if (kind === 'persistentvolume' && copy.spec && typeof copy.spec === 'object') {
      delete (copy.spec as { claimRef?: unknown }).claimRef;
    }
  } else {
    md.namespace = ns;
  }
  if (md.annotations) {
    delete md.annotations['kubectl.kubernetes.io/last-applied-configuration'];
    for (const key of Object.keys(md.annotations)) {
      if (BINDING_ANNOTATION_PREFIXES.some((p) => key.startsWith(p))) delete md.annotations[key];
    }
    if (!Object.keys(md.annotations).length) delete md.annotations;
  }
  copy.metadata = md;

  if (kind === 'service' && copy.spec) {
    delete copy.spec.clusterIP;
    delete copy.spec.clusterIPs;
    delete copy.spec.ipFamilies;
    delete copy.spec.ipFamilyPolicy;
  }
  if (kind === 'serviceaccount') {
    delete copy.secrets;
  }
  if (kind === 'job' && copy.spec) {
    // The API server generates these; re-applying them is rejected.
    delete copy.spec.selector;
    const tpl = copy.spec.template as { metadata?: { labels?: Record<string, string> } } | undefined;
    for (const label of JOB_GENERATED_LABELS) delete tpl?.metadata?.labels?.[label];
  }
  if (kind === 'pod' && copy.spec) {
    // Drop scheduling / runtime fields so apply can recreate a fresh Pod.
    delete copy.spec.nodeName;
    delete copy.spec.nominatedNodeName;
    delete copy.spec.runtimeClassName;
    if (Array.isArray(copy.spec.volumes)) {
      copy.spec.volumes = (copy.spec.volumes as Array<{ name?: string }>).filter(
        (v) => !String(v.name || '').startsWith('kube-api-access-'),
      );
    }
    if (Array.isArray(copy.spec.containers)) {
      for (const c of copy.spec.containers as Array<{ volumeMounts?: Array<{ name?: string }> }>) {
        if (!Array.isArray(c.volumeMounts)) continue;
        c.volumeMounts = c.volumeMounts.filter(
          (m) => !String(m.name || '').startsWith('kube-api-access-'),
        );
      }
    }
  }
  return copy;
}

/** PVs and StorageClasses labeled for the namespace, in one API round-trip. */
async function listLabeledClusterStorage(ns: string): Promise<{ pvs: K8sObject[]; storageClasses: K8sObject[] }> {
  const r = await runKubectl(
    ['get', 'pv,storageclass', '-l', `${LEARNER_NS_PV_LABEL}=${ns}`, '-o', 'json'],
    { timeoutMs: 45_000 },
  );
  if (r.code !== 0) {
    throw Object.assign(new Error(`listing pv,storageclass for ${ns} failed: ${(r.stderr || r.stdout).trim()}`), { status: 502 });
  }
  const doc = JSON.parse(r.stdout) as { items?: K8sObject[] };
  const items = Array.isArray(doc.items) ? doc.items : [];
  const pvs: K8sObject[] = [];
  const storageClasses: K8sObject[] = [];
  for (const obj of items) {
    if (obj.kind === 'StorageClass') {
      if (!obj.apiVersion) obj.apiVersion = 'storage.k8s.io/v1';
      storageClasses.push(obj);
    } else {
      if (!obj.kind) obj.kind = 'PersistentVolume';
      if (!obj.apiVersion) obj.apiVersion = 'v1';
      pvs.push(obj);
    }
  }
  return { pvs, storageClasses };
}

/** Every learner-manageable object in the namespace. Throws rather than returning a partial list. */
async function listLearnerObjects(ns: string): Promise<K8sObject[]> {
  const kinds = await learnerKinds();
  if (!kinds.length) return [];
  const r = await runKubectl(['get', kinds.map((k) => k.ref).join(','), '-n', ns, '-o', 'json'], {
    timeoutMs: 60_000,
  });
  if (r.code !== 0) {
    throw Object.assign(new Error(`listing ${ns} failed: ${(r.stderr || r.stdout).trim()}`), { status: 502 });
  }
  const doc = JSON.parse(r.stdout) as { items?: K8sObject[] };
  return Array.isArray(doc.items) ? doc.items : [];
}

/**
 * Export the lab's state (learner objects + PVs / StorageClasses labeled for this
 * namespace) to the backend-only snapshot store. Throws if the cluster could not
 * be read, so callers never wipe on the strength of an incomplete snapshot.
 */
async function snapshotChallengeNamespace(ns: string, challengeId: string): Promise<string> {
  const items: K8sObject[] = [];
  const [objects, storage] = await Promise.all([listLearnerObjects(ns), listLabeledClusterStorage(ns)]);
  for (const raw of [...objects, ...storage.pvs, ...storage.storageClasses]) {
    const clean = sanitizeForReapply(raw, ns);
    if (clean) items.push(clean);
  }

  // A claim pinned to a dynamically provisioned PV would stay Pending forever once
  // that PV is reclaimed; keep the pin only for platform PVs saved alongside.
  const savedPvs = new Set(
    items.filter((i) => i.kind === 'PersistentVolume').map((i) => i.metadata?.name),
  );
  for (const item of items) {
    if (item.kind !== 'PersistentVolumeClaim' || !item.spec) continue;
    const volumeName = item.spec.volumeName as string | undefined;
    if (volumeName && !savedPvs.has(volumeName)) delete item.spec.volumeName;
  }

  const dest = snapshotFilePath(ns, challengeId);
  fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
  const payload = {
    apiVersion: 'v1',
    kind: 'List',
    metadata: {
      challengeId,
      namespace: ns,
      snappedAt: new Date().toISOString(),
    },
    items,
  };
  const tmp = `${dest}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, dest);
  return dest;
}

function readSnapshotFile(file: string): K8sObject[] | null {
  try {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8')) as { items?: K8sObject[] };
    return Array.isArray(doc.items) ? doc.items : [];
  } catch {
    return null;
  }
}

function readChallengeSnapshot(
  ns: string,
  challengeId: string,
): { path: string; items: K8sObject[] } | null {
  const dest = snapshotFilePath(ns, challengeId);
  if (fs.existsSync(dest)) {
    const items = readSnapshotFile(dest);
    return items ? { path: dest, items } : null;
  }
  // One-time move from the learner home. Contents are untrusted: restore vets them.
  const legacy = legacySnapshotFilePath(ns, challengeId);
  if (!fs.existsSync(legacy)) return null;
  const items = readSnapshotFile(legacy);
  try {
    fs.rmSync(legacy, { force: true });
  } catch {
    /* ignore */
  }
  if (!items) return null;
  fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
  fs.writeFileSync(dest, `${JSON.stringify({ apiVersion: 'v1', kind: 'List', items }, null, 2)}\n`, {
    mode: 0o600,
  });
  return { path: dest, items };
}

function deleteChallengeSnapshot(ns: string, challengeId: string): void {
  for (const file of [snapshotFilePath(ns, challengeId), legacySnapshotFilePath(ns, challengeId)]) {
    try {
      fs.rmSync(file, { force: true });
    } catch {
      /* ignore */
    }
  }
}

const PV_PATH_RE = /^\/mnt\/(data|local-ssd)\/[A-Za-z0-9._-]+$/;
const PV_SPEC_KEYS = new Set([
  'capacity',
  'accessModes',
  'persistentVolumeReclaimPolicy',
  'storageClassName',
  'volumeMode',
  'hostPath',
  'local',
  'nodeAffinity',
  'mountOptions',
]);
const SC_PROVISIONERS = new Set(['ebs.csi.aws.com', 'kubernetes.io/no-provisioner']);

/**
 * Cluster-scoped objects are re-created with controller rights, so only shapes the
 * storage labs' setup.sh produce are accepted: labeled for this namespace, named
 * with its suffix, and (for PVs) a node path under /mnt/{data,local-ssd}/ unique
 * to this namespace.
 */
function clusterScopedRejection(obj: K8sObject, ns: string): string | null {
  const name = obj.metadata?.name || '';
  if (obj.metadata?.labels?.[LEARNER_NS_PV_LABEL] !== ns) return 'not labeled for this namespace';
  if (!name.endsWith(`-${ns}`)) return 'name lacks namespace suffix';
  if (obj.kind === 'StorageClass') {
    return SC_PROVISIONERS.has(String(obj.provisioner || '')) ? null : 'provisioner not allowed';
  }
  const spec = (obj.spec || {}) as Record<string, unknown>;
  const extra = Object.keys(spec).filter((k) => !PV_SPEC_KEYS.has(k));
  if (extra.length) return `unsupported PV fields: ${extra.join(', ')}`;
  const source = (spec.hostPath || spec.local) as { path?: string } | undefined;
  if (!source || (spec.hostPath && spec.local)) return 'PV needs exactly one of hostPath / local';
  const p = String(source.path || '');
  if (!PV_PATH_RE.test(p) || !p.includes(ns)) return `PV path not allowed: ${p}`;
  return null;
}

/**
 * Re-apply a parked snapshot. Namespaced objects are applied with the learner's
 * own credentials, so a snapshot can never hold more than the learner could have
 * created by hand; cluster-scoped storage goes through clusterScopedRejection.
 * Returns true if anything was applied.
 */
async function restoreChallengeSnapshot(ns: string, challengeId: string): Promise<boolean> {
  const snap = readChallengeSnapshot(ns, challengeId);
  if (!snap || !snap.items.length) return false;

  const pvs: K8sObject[] = [];
  const storageClasses: K8sObject[] = [];
  const namespaced: K8sObject[] = [];
  const rejected: string[] = [];
  for (const obj of snap.items) {
    const copy = sanitizeForReapply(JSON.parse(JSON.stringify(obj)) as K8sObject, ns);
    if (!copy) continue;
    const label = `${copy.kind}/${copy.metadata?.name}`;
    if (copy.kind === 'PersistentVolume' || copy.kind === 'StorageClass') {
      const why = clusterScopedRejection(copy, ns);
      if (why) {
        rejected.push(`${label} (${why})`);
        continue;
      }
      (copy.kind === 'PersistentVolume' ? pvs : storageClasses).push(copy);
    } else if (isLearnerManaged(copy)) {
      namespaced.push(copy);
    } else {
      rejected.push(`${label} (kind not restorable)`);
    }
  }
  if (rejected.length) {
    console.warn(`[k8s] snapshot ${ns}/${challengeId}: skipped ${rejected.join('; ')}`);
  }

  // Cluster-scoped first so PVC storageClassName / volumeName can succeed on restore.
  if (storageClasses.length) {
    await kubectlOk(['apply', '-f', '-'], {
      input: JSON.stringify({ apiVersion: 'v1', kind: 'List', items: storageClasses }),
      timeoutMs: 120_000,
    });
  }
  if (pvs.length) {
    await kubectlOk(['apply', '-f', '-'], {
      input: JSON.stringify({ apiVersion: 'v1', kind: 'List', items: pvs }),
      timeoutMs: 120_000,
    });
  }
  if (namespaced.length) {
    const learnerKubeconfig = await createLearnerKubeconfig(ns);
    await kubectlOk(['apply', '-f', '-', '-n', ns], {
      input: JSON.stringify({ apiVersion: 'v1', kind: 'List', items: namespaced }),
      timeoutMs: 120_000,
      learnerKubeconfig,
    });
  }
  return storageClasses.length + pvs.length + namespaced.length > 0;
}

/**
 * Snapshot, then wipe. Called (under the lifecycle namespace lock) when a K8s
 * session ends. A failed snapshot aborts the wipe so progress is never lost.
 */
async function parkChallengeNamespace(ns: string, challengeId: string): Promise<void> {
  await snapshotChallengeNamespace(ns, challengeId);
  await wipeChallengeResources(ns, challengeId);
  await revokeLearnerAccess(ns);
}

const WIPE_TIMEOUT = '120s';
const WIPE_CHUNK = 150;
/** Controllers can recreate a pod deleted just before its ReplicaSet / Job. */
const WIPE_PASSES = 3;

async function learnerObjectRefs(ns: string): Promise<string[]> {
  const kinds = await learnerKinds();
  const byKind = new Map(kinds.map((k) => [`${k.group}/${k.resource}`, k.ref]));
  const refs: string[] = [];
  for (const obj of await listLearnerObjects(ns)) {
    if (isPlatformObject(obj)) continue;
    const ref = byKind.get(`${groupOf(obj.apiVersion)}/${pluralOf(obj.kind || '')}`);
    if (ref && obj.metadata?.name) refs.push(`${ref}/${obj.metadata.name}`);
  }
  return refs;
}

/**
 * Learner objects (platform ones excluded, terminating ones included) and PVs /
 * StorageClasses labeled for the namespace that still exist. Empty means the
 * namespace is a clean slate. Throws if the cluster cannot be read.
 */
async function leftoverState(ns: string): Promise<{ refs: string[]; clusterRefs: string[] }> {
  const [refs, storage] = await Promise.all([learnerObjectRefs(ns), listLabeledClusterStorage(ns)]);
  const clusterRefs = [
    ...storage.pvs.map((o) => `pv/${o.metadata?.name || '?'}`),
    ...storage.storageClasses.map((o) => `storageclass/${o.metadata?.name || '?'}`),
  ];
  return { refs, clusterRefs };
}

async function listLeftoverResources(ns: string): Promise<string[]> {
  const { refs, clusterRefs } = await leftoverState(ns);
  return [...refs, ...clusterRefs];
}

/**
 * Delete every learner-manageable object in the namespace (platform SA / Role /
 * RoleBinding / quota kept) plus PVs / StorageClasses labeled for it, and wait
 * until they are actually gone. Throws if anything is still there afterwards,
 * so a following lab never starts on top of another lab's objects.
 */
async function wipeChallengeResources(ns: string, challengeId: string | null): Promise<void> {
  let verifiedClean = false;
  for (let pass = 0; pass < WIPE_PASSES; pass += 1) {
    const { refs, clusterRefs } = await leftoverState(ns);
    const clusterLeft = clusterRefs.length;
    if (!refs.length && !clusterLeft) {
      verifiedClean = true;
      break;
    }
    for (let i = 0; i < refs.length; i += WIPE_CHUNK) {
      const r = await runKubectl([
        'delete',
        ...refs.slice(i, i + WIPE_CHUNK),
        '-n',
        ns,
        '--ignore-not-found',
        '--grace-period=5',
        '--wait=true',
        `--timeout=${WIPE_TIMEOUT}`,
      ], { timeoutMs: 150_000 });
      if (r.code !== 0) {
        console.warn(`[k8s] wipe ${ns}: ${(r.stderr || r.stdout).trim()}`);
      }
    }
    if (clusterLeft) {
      await runKubectl([
        'delete',
        'pv,storageclass',
        '-l',
        `${LEARNER_NS_PV_LABEL}=${ns}`,
        '--ignore-not-found',
        '--wait=true',
        `--timeout=${WIPE_TIMEOUT}`,
      ], { timeoutMs: 150_000 });
    }
  }
  const left = verifiedClean ? [] : await listLeftoverResources(ns);
  if (left.length) {
    throw Object.assign(
      new Error(`wipe of ${ns} left ${left.length} object(s): ${left.slice(0, 10).join(', ')}`),
      { status: 502 },
    );
  }
  if (challengeId) await clearChallengeSetup(ns, challengeId);
}

/**
 * Invalidate every token minted for the learner SA (deleting the SA voids bound
 * tokens), so a terminal or copied kubeconfig from a finished lab cannot write
 * into the namespace. The next lab open re-creates the SA.
 */
async function revokeLearnerAccess(ns: string): Promise<void> {
  invalidateNsCaches(ns);
  await runKubectl(['delete', 'serviceaccount', LEARNER_SA, '-n', ns, '--ignore-not-found', '--wait=true'], {
    timeoutMs: 45_000,
  });
}

const CONTROLLER_KUBE_DIR = path.join(os.tmpdir(), 'dl-k8s-controller');
let controllerKubeconfigToken: string | null = null;

/**
 * Admin kubeconfig carrying the cached EKS token, for challenge scripts (their
 * kubectl calls would otherwise exec `aws eks get-token` each time). Backend-only:
 * never mount this directory into lab shells. Null when no cached token applies.
 */
async function controllerTokenKubeconfig(): Promise<string | null> {
  if (process.env.K8S_LAB_CONTEXT) return null;
  const token = await getControllerIamToken();
  if (!token) return null;
  const dest = path.join(CONTROLLER_KUBE_DIR, 'config');
  if (controllerKubeconfigToken === token && fs.existsSync(dest)) return dest;

  const cluster = await resolveClusterEndpoint();
  const clusterBlock = cluster.skipTls || !cluster.caData
    ? `    server: ${cluster.server}\n    insecure-skip-tls-verify: true`
    : `    server: ${cluster.server}\n    certificate-authority-data: ${cluster.caData}`;
  const kubeconfig = `apiVersion: v1
kind: Config
clusters:
- name: devlabs-lab
  cluster:
${clusterBlock}
users:
- name: controller
  user:
    token: ${token}
contexts:
- name: controller
  context:
    cluster: devlabs-lab
    user: controller
current-context: controller
`;
  fs.mkdirSync(CONTROLLER_KUBE_DIR, { recursive: true, mode: 0o700 });
  const tmp = `${dest}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, kubeconfig, { mode: 0o600 });
  fs.renameSync(tmp, dest);
  controllerKubeconfigToken = token;
  return dest;
}

function scriptsDir(challengeId: string): string {
  return labPackDir(challengeId);
}

async function runChallengeScript(
  ns: string,
  challengeId: string,
  scriptName: string,
  opts: { timeoutMs?: number; env?: Record<string, string> } = {},
): Promise<KubectlResult> {
  const scriptPath = path.join(scriptsDir(challengeId), scriptName);
  const timeoutMs = opts.timeoutMs ?? 90_000;
  const tokenKubeconfig = await controllerTokenKubeconfig().catch((err: Error) => {
    warnControllerTokenOnce(err);
    return null;
  });
  const env = {
    ...kubectlEnv(),
    ...(tokenKubeconfig ? { KUBECONFIG: tokenKubeconfig } : {}),
    LEARNER_NS: ns,
    CHALLENGE_ID: challengeId,
    CHALLENGE_LABEL,
    KUBECTL_NAMESPACE: ns,
    ...(opts.env || {}),
  };
  return new Promise((resolve, reject) => {
    const child = spawn('bash', [scriptPath], {
      env,
      cwd: path.dirname(scriptPath),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(Object.assign(new Error(`script timed out: ${scriptName}`), { status: 504 }));
    }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

const ALLOWED_KUBECTL_VERBS = new Set([
  'get',
  'describe',
  'logs',
  'apply',
  'create',
  'delete',
  'replace',
  'patch',
  'label',
  'annotate',
  'expose',
  'run',
  'set',
  'scale',
  'rollout',
  'wait',
  'top',
  'explain',
  'api-resources',
  'version',
  'auth',
  'exec',
  'cp',
  'diff',
]);

function assertSafeLearnerArgs(args: string[]): void {
  if (!args.length) {
    throw Object.assign(new Error('kubectl args required'), { status: 400 });
  }
  const verb = args[0];
  if (!ALLOWED_KUBECTL_VERBS.has(verb)) {
    throw Object.assign(new Error(`kubectl verb not allowed: ${verb}`), { status: 400 });
  }
  const joined = args.join(' ');
  if (/\s-A\b/.test(` ${joined}`) || args.includes('--all-namespaces')) {
    throw Object.assign(new Error('--all-namespaces is not allowed'), { status: 400 });
  }
  if (verb === 'delete' && args.some((a) => a === 'ns' || a === 'namespace' || a === 'namespaces')) {
    throw Object.assign(new Error('deleting namespaces is not allowed'), { status: 400 });
  }
  if (
    (verb === 'create' || verb === 'apply')
    && args.some((a) => a === 'ns' || a === 'namespace' || a === 'namespaces')
  ) {
    throw Object.assign(new Error('creating namespaces is not allowed in this lab'), { status: 400 });
  }
}

/** Run learner kubectl as their SA, forced into their namespace. */
async function learnerKubectl(
  ns: string,
  args: string[],
  _opts: { challengeId?: string | null } = {},
): Promise<KubectlResult> {
  const cleaned: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-n' || args[i] === '--namespace') {
      i += 1;
      continue;
    }
    cleaned.push(args[i]);
  }
  assertSafeLearnerArgs(cleaned);

  const kubeconfigPath = await createLearnerKubeconfig(ns);
  try {
    const timeoutMs = 45_000;
    // Do not pass admin --context; learner kubeconfig is self-contained.
    const fullArgs = ['--kubeconfig', kubeconfigPath, '-n', ns, ...cleaned];
    return await new Promise((resolve, reject) => {
      const child = spawn('kubectl', fullArgs, {
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(Object.assign(new Error(`kubectl timed out after ${timeoutMs}ms`), { status: 504 }));
      }, timeoutMs);
      child.stdout.on('data', (d: Buffer) => {
        stdout += d.toString();
      });
      child.stderr.on('data', (d: Buffer) => {
        stderr += d.toString();
      });
      child.on('error', (err: Error) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on('close', (code: number | null) => {
        clearTimeout(timer);
        resolve({ code: code ?? 1, stdout, stderr });
      });
    });
  } finally {
    removeLearnerKubeconfig(kubeconfigPath);
  }
}

module.exports = {
  CHALLENGE_LABEL,
  LEARNER_SA,
  LEARNER_ROLE,
  LEARNER_ROLEBINDING,
  learnerNamespace,
  setupAnnotationKey,
  runKubectl,
  kubectlOk,
  controllerKubectlCommand,
  ensureLearnerNamespace,
  ensureLearnerRbac,
  createLearnerKubeconfig,
  removeLearnerKubeconfig,
  hasChallengeSetup,
  markChallengeSetup,
  clearChallengeSetup,
  wipeChallengeResources,
  listLeftoverResources,
  snapshotChallengeNamespace,
  restoreChallengeSnapshot,
  deleteChallengeSnapshot,
  parkChallengeNamespace,
  revokeLearnerAccess,
  readChallengeSnapshot,
  snapshotFilePath,
  resolveLearnerHome,
  scriptsDir,
  runChallengeScript,
  learnerKubectl,
  assertSafeLearnerArgs,
};
