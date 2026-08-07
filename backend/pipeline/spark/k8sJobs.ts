'use strict';

/**
 * Thin kubectl wrapper for one-off batch Jobs (data gen).
 *
 * Prefers shell kubectl + KUBECONFIG (same as platforms/devlabs-data scripts)
 * so we do not add @kubernetes/client-node yet.
 */

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface K8sJobResult {
  ok: boolean;
  name: string;
  namespace: string;
  logs: string;
  message: string;
}

function kubectlEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  // Homebrew kubectl on macOS
  const brew = '/opt/homebrew/bin';
  if (fs.existsSync(brew) && !(env.PATH || '').includes(brew)) {
    env.PATH = `${brew}:${env.PATH || ''}`;
  }
  return env;
}

function runKubectl(
  args: string[],
  opts?: { timeoutMs?: number; input?: string },
): { ok: boolean; stdout: string; stderr: string; status: number | null } {
  const res = spawnSync('kubectl', args, {
    encoding: 'utf8',
    env: kubectlEnv(),
    input: opts?.input,
    timeout: opts?.timeoutMs ?? 60_000,
    maxBuffer: 20 * 1024 * 1024,
  });
  return {
    ok: !res.error && res.status === 0,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
    status: res.status,
  };
}

function kubectlAvailable(): boolean {
  const res = runKubectl(['version', '--client', '--output=yaml'], { timeoutMs: 15_000 });
  return res.ok;
}

/** Probe whether the configured cluster API is reachable. */
function clusterReachable(): { ok: boolean; message: string } {
  const res = runKubectl(['cluster-info'], { timeoutMs: 15_000 });
  if (res.ok) return { ok: true, message: 'ok' };
  const detail = (res.stderr || res.stdout || '').trim();
  const kubeconfig = process.env.KUBECONFIG || '(default ~/.kube/config)';
  if (/connection refused|i\/o timeout|Temporary failure|no such host|dial tcp/i.test(detail)) {
    return {
      ok: false,
      message: [
        'Kubernetes API unreachable — data-gen Jobs cannot be submitted.',
        `KUBECONFIG=${kubeconfig}`,
        'Start/reconnect the cluster (e.g. colima start, or your Mac Mini tunnel), then retry Eval.',
        detail.slice(-500),
      ].join(' '),
    };
  }
  return {
    ok: false,
    message: detail.slice(-800) || 'kubectl cluster-info failed',
  };
}

function applyManifest(yaml: string): { ok: boolean; message: string } {
  const tmp = path.join(os.tmpdir(), `devlabs-job-${Date.now()}.yaml`);
  try {
    fs.writeFileSync(tmp, yaml, 'utf8');
    // --validate=false: skip client OpenAPI download (fails loudly when API is flaky)
    const res = runKubectl(['apply', '--validate=false', '-f', tmp], { timeoutMs: 60_000 });
    if (!res.ok) {
      const raw = res.stderr.trim() || res.stdout.trim() || `kubectl apply exited ${res.status}`;
      if (/connection refused|failed to download openapi|dial tcp/i.test(raw)) {
        const reach = clusterReachable();
        return { ok: false, message: reach.ok ? raw : reach.message };
      }
      return { ok: false, message: raw };
    }
    return { ok: true, message: res.stdout.trim() };
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

function jobTerminalState(
  name: string,
  namespace: string,
): { state: 'complete' | 'failed' | 'running' | 'unknown'; detail: string } {
  const res = runKubectl(
    ['get', 'job', name, '-n', namespace, '-o', 'json'],
    { timeoutMs: 20_000 },
  );
  if (!res.ok) {
    return { state: 'unknown', detail: (res.stderr || res.stdout || '').slice(-500) };
  }
  try {
    const job = JSON.parse(res.stdout) as {
      status?: { succeeded?: number; failed?: number; active?: number; conditions?: Array<{ type?: string; status?: string }> };
    };
    const succeeded = Number(job.status?.succeeded || 0);
    const failed = Number(job.status?.failed || 0);
    if (succeeded > 0) return { state: 'complete', detail: 'succeeded' };
    // Job Failed condition or backoff exhausted
    const condFailed = (job.status?.conditions || []).some(
      (c) => c.type === 'Failed' && c.status === 'True',
    );
    if (failed > 0 || condFailed) {
      return { state: 'failed', detail: `failed=${failed}` };
    }
    return { state: 'running', detail: `active=${job.status?.active || 0}` };
  } catch (e) {
    return { state: 'unknown', detail: e instanceof Error ? e.message : String(e) };
  }
}

async function waitForJob({
  name,
  namespace,
  timeoutMs,
}: {
  name: string;
  namespace: string;
  timeoutMs: number;
}): Promise<{ ok: boolean; message: string }> {
  // Poll complete OR failed — never block only on condition=complete (failed jobs hang until timeout).
  const deadline = Date.now() + Math.max(30_000, timeoutMs);
  const pollMs = 3_000;
  while (Date.now() < deadline) {
    const term = jobTerminalState(name, namespace);
    if (term.state === 'complete') {
      return { ok: true, message: 'job complete' };
    }
    if (term.state === 'failed') {
      const describe = runKubectl(
        ['describe', 'job', name, '-n', namespace],
        { timeoutMs: 30_000 },
      );
      return {
        ok: false,
        message: `job failed: ${(describe.stdout || term.detail).slice(-1500)}`,
      };
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  const describe = runKubectl(
    ['describe', 'job', name, '-n', namespace],
    { timeoutMs: 30_000 },
  );
  return {
    ok: false,
    message: `job wait timed out: ${(describe.stdout || '').slice(-1500)}`,
  };
}

function jobLogs(name: string, namespace: string): string {
  const res = runKubectl(['logs', '-n', namespace, `job/${name}`, '--tail=500'], {
    timeoutMs: 60_000,
  });
  return (res.stdout || res.stderr || '').trim();
}

async function createAndWaitJob({
  name,
  namespace,
  yaml,
  timeoutMs,
}: {
  name: string;
  namespace: string;
  yaml: string;
  timeoutMs: number;
}): Promise<K8sJobResult> {
  if (!kubectlAvailable()) {
    return {
      ok: false,
      name,
      namespace,
      logs: '',
      message: 'kubectl not available — set KUBECONFIG or install kubectl',
    };
  }

  const reach = clusterReachable();
  if (!reach.ok) {
    return {
      ok: false,
      name,
      namespace,
      logs: '',
      message: reach.message,
    };
  }

  const applied = applyManifest(yaml);
  if (!applied.ok) {
    return { ok: false, name, namespace, logs: '', message: applied.message };
  }

  const waited = await waitForJob({ name, namespace, timeoutMs });
  const logs = jobLogs(name, namespace);
  return {
    ok: waited.ok,
    name,
    namespace,
    logs,
    message: waited.ok ? 'job succeeded' : waited.message,
  };
}

module.exports = {
  kubectlAvailable,
  clusterReachable,
  createAndWaitJob,
  applyManifest,
  waitForJob,
  jobLogs,
};
