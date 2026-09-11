'use strict';

/**
 * kubectl helpers for per-learner Kubernetes labs.
 * Env:
 *   K8S_LAB_KUBECONFIG — kubeconfig path (falls back to KUBECONFIG / default)
 *   K8S_LAB_CONTEXT — optional context name
 *   K8S_LAB_INSECURE_SKIP_TLS_VERIFY=true — local/Colima only when CA is stale
 *
 * Isolation: each learner gets Namespace ns-<user> plus a ServiceAccount
 * bound via Role/RoleBinding. Interactive shell + /k8s/exec use a token
 * kubeconfig for that SA (not the controller admin kubeconfig).
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const workspaceStore = require('./workspaceStore');

const CHALLENGE_LABEL = 'devlabs.dev/challenge';
const SETUP_ANNOTATION_PREFIX = 'devlabs.dev/setup-';
/** Stable names inside each learner namespace (not challenge-labeled → survive wipe). */
const LEARNER_SA = 'devlabs-learner';
const LEARNER_ROLE = 'devlabs-learner';
const LEARNER_ROLEBINDING = 'devlabs-learner';
const LEARNER_TOKEN_DURATION = process.env.K8S_LAB_TOKEN_DURATION || '12h';

const DEFAULT_QUOTA = {
  pods: '20',
  cpu: '2',
  memory: '2Gi',
};

/** Default lab namespace: ns-<user-name> (DNS-1123, max 63). */
function learnerNamespace(userName: string): string {
  const owner = workspaceStore.sanitizeOwner(userName || 'anonymous').toLowerCase();
  const base = `ns-${owner}`.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
  return base.slice(0, 63).replace(/-$/, '') || 'ns-anonymous';
}

function setupAnnotationKey(challengeId: string): string {
  const safe = (challengeId || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 40);
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
  opts: { timeoutMs?: number; input?: string } = {},
): Promise<KubectlResult> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const fullArgs = [...kubectlBaseArgs(), ...args];
  return new Promise((resolve, reject) => {
    const child = spawn('kubectl', fullArgs, {
      env: kubectlEnv(),
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
}

async function kubectlOk(args: string[], opts?: { timeoutMs?: number; input?: string }): Promise<string> {
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

/** Namespaced Role rules: full CRUD in-ns for CKAD-style labs (incl. RBAC objects). */
function learnerRbacYaml(ns: string): string {
  return `
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
  - apiGroups: ["", "apps", "batch", "extensions", "networking.k8s.io", "policy", "autoscaling", "rbac.authorization.k8s.io", "metrics.k8s.io"]
    resources: ["*"]
    verbs: ["*"]
  - apiGroups: [""]
    resources: ["pods/exec", "pods/log", "pods/portforward", "pods/attach", "pods/ephemeralcontainers"]
    verbs: ["*"]
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
`;
}

async function ensureLearnerRbac(ns: string): Promise<void> {
  await kubectlOk(['apply', '-f', '-'], { input: learnerRbacYaml(ns) });
}

async function ensureLearnerNamespace(
  ns: string,
  quota: { pods?: string; cpu?: string; memory?: string } = {},
): Promise<void> {
  const q = { ...DEFAULT_QUOTA, ...quota };
  if (!(await namespaceExists(ns))) {
    const created = await runKubectl(['create', 'namespace', ns]);
    if (created.code !== 0 && !/AlreadyExists/i.test(created.stderr || '')) {
      throw Object.assign(new Error((created.stderr || created.stdout || 'create ns failed').trim()), {
        status: 502,
      });
    }
  }

  const quotaYaml = `
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
    requests.cpu: "${q.cpu}"
    requests.memory: "${q.memory}"
    limits.cpu: "${q.cpu}"
    limits.memory: "${q.memory}"
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
    - type: Container
      defaultRequest:
        cpu: 50m
        memory: 64Mi
      default:
        cpu: 250m
        memory: 256Mi
`;
  await kubectlOk(['apply', '-f', '-'], { input: quotaYaml });
  await ensureLearnerRbac(ns);
}

/**
 * Build a short-lived kubeconfig authenticating as the learner SA in `ns`.
 * Controller (admin) kubeconfig is used only to mint the token + read cluster endpoint.
 */
async function createLearnerKubeconfig(ns: string): Promise<string> {
  await ensureLearnerRbac(ns);

  const tokenResult = await runKubectl([
    'create',
    'token',
    LEARNER_SA,
    '-n',
    ns,
    `--duration=${LEARNER_TOKEN_DURATION}`,
  ]);
  if (tokenResult.code !== 0) {
    const msg = (tokenResult.stderr || tokenResult.stdout || 'create token failed').trim();
    throw Object.assign(new Error(msg), { status: 502 });
  }
  const token = tokenResult.stdout.trim();
  if (!token) {
    throw Object.assign(new Error('empty service account token'), { status: 502 });
  }

  const view = await runKubectl(['config', 'view', '--minify', '--raw', '-o', 'json']);
  if (view.code !== 0) {
    throw Object.assign(new Error((view.stderr || 'config view failed').trim()), { status: 502 });
  }
  const doc = JSON.parse(view.stdout) as {
    clusters?: Array<{
      name?: string;
      cluster?: {
        server?: string;
        'certificate-authority-data'?: string;
        'insecure-skip-tls-verify'?: boolean;
      };
    }>;
  };
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

  const caData = cluster?.['certificate-authority-data'];
  let clusterBlock: string;
  if (skipTls || !caData) {
    clusterBlock = `  cluster:
    server: ${server}
    insecure-skip-tls-verify: true`;
  } else {
    clusterBlock = `  cluster:
    server: ${server}
    certificate-authority-data: ${caData}`;
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

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-k8s-learner-'));
  const dest = path.join(dir, 'config');
  fs.writeFileSync(dest, kubeconfig, { mode: 0o600 });
  return dest;
}

function removeLearnerKubeconfig(kubeconfigPath: string): void {
  try {
    fs.rmSync(path.dirname(kubeconfigPath), { recursive: true, force: true });
  } catch (_e) {
    /* ignore */
  }
}

async function hasChallengeSetup(ns: string, challengeId: string): Promise<boolean> {
  const key = setupAnnotationKey(challengeId);
  const raw = await runKubectl(['get', 'ns', ns, '-o', 'json']);
  if (raw.code !== 0) return false;
  try {
    const doc = JSON.parse(raw.stdout) as {
      metadata?: { annotations?: Record<string, string> };
    };
    return doc.metadata?.annotations?.[key] === '1';
  } catch {
    return false;
  }
}

async function markChallengeSetup(ns: string, challengeId: string): Promise<void> {
  const key = setupAnnotationKey(challengeId);
  await kubectlOk(['annotate', 'ns', ns, `${key}=1`, '--overwrite']);
}

async function clearChallengeSetup(ns: string, challengeId: string): Promise<void> {
  const key = setupAnnotationKey(challengeId);
  await runKubectl(['annotate', 'ns', ns, `${key}-`]);
}

/** Delete learner workloads in the namespace (keeps DevLabs SA / Role / RoleBinding). */
async function wipeChallengeResources(ns: string, _challengeId: string): Promise<void> {
  const kinds = [
    'deployments,statefulsets,daemonsets,replicasets,pods,jobs,cronjobs',
    'services,ingresses,networkpolicies',
    'persistentvolumeclaims',
  ];
  for (const kind of kinds) {
    await runKubectl([
      'delete',
      kind,
      '-n',
      ns,
      '--all',
      '--ignore-not-found',
      '--wait=false',
    ]);
  }
  // ConfigMaps / Secrets: wipe learner-created ones; keep default service-account token CA.
  await runKubectl([
    'delete',
    'configmaps,secrets',
    '-n',
    ns,
    '--all',
    '--ignore-not-found',
    '--wait=false',
  ]);
  // Re-ensure platform RBAC objects if a broad delete ever touched them.
  await ensureLearnerRbac(ns);
  await clearChallengeSetup(ns, _challengeId);
}

function scriptsDir(challengeId: string): string {
  return path.join(__dirname, '..', 'challenges', 'k8s', challengeId);
}

async function runChallengeScript(
  ns: string,
  challengeId: string,
  scriptName: string,
  opts: { timeoutMs?: number } = {},
): Promise<KubectlResult> {
  const scriptPath = path.join(scriptsDir(challengeId), scriptName);
  const timeoutMs = opts.timeoutMs ?? 90_000;
  const env = {
    ...kubectlEnv(),
    LEARNER_NS: ns,
    CHALLENGE_ID: challengeId,
    CHALLENGE_LABEL,
    KUBECTL_NAMESPACE: ns,
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
  ensureLearnerNamespace,
  ensureLearnerRbac,
  createLearnerKubeconfig,
  removeLearnerKubeconfig,
  hasChallengeSetup,
  markChallengeSetup,
  clearChallengeSetup,
  wipeChallengeResources,
  scriptsDir,
  runChallengeScript,
  learnerKubectl,
  assertSafeLearnerArgs,
};
