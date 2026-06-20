'use strict';

/**
 * Execute validationSpec.graph — ordered actions, fork/join, snapshots for LLM judge.
 * No programmatic assert nodes; pass/fail on broken state is judge-only.
 */

import type { PortMap } from '../../types/domain';
import type {
  ValidationGraphNode,
  ValidationGraphSpec,
  ValidationGraphNodeSnapshot,
  ValidationGraphRunResult,
  ValidationGraphEntry,
  ValidationGraphSuiteResult,
} from './validationGraphTypes';

const composeManager = require('../../sandbox/composeManager');
const { evaluateCheck } = require('./validationChecks');

const MAX_SNAPSHOT_CHARS = 4000;
const DEFAULT_EXEC_TIMEOUT_MS = 120_000;

interface BackgroundJob {
  nodeId: string;
  promise: Promise<void>;
  stop?: () => void;
}

function cap(s: string, max = MAX_SNAPSHOT_CHARS): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n…[truncated ${s.length - max} chars]`;
}

function nodeLabel(nodeId: string, node: ValidationGraphNode): string {
  if (node.type === 'http') {
    return `${node.method || 'GET'} ${node.service}${node.path || '/'}`;
  }
  if (node.type === 'exec' || node.type === 'background') {
    const cmd = Array.isArray(node.cmd) ? node.cmd.join(' ') : String(node.cmd || '');
    return `${node.service}: ${cmd.slice(0, 120)}`;
  }
  if (node.type === 'wait') return `wait ${node.ms || 0}ms`;
  if (node.type === 'fork') return `fork → ${(node.branches || []).join(', ')}`;
  if (node.type === 'join') return `join (${(node.waitFor || []).join(', ')})`;
  if (node.type === 'stop') return `stop ${(node.targets || []).join(', ')}`;
  return nodeId;
}

function tryParseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch (_e) {
    return body;
  }
}

function buildSnapshotPayload(
  nodeId: string,
  node: ValidationGraphNode,
  data: {
    ok: boolean;
    error?: string | null;
    statusCode?: number | null;
    stdout?: string;
    stderr?: string;
    body?: string;
    ms?: number;
  },
): ValidationGraphNodeSnapshot {
  const snapshot: Record<string, unknown> = {};
  if (data.body) {
    snapshot.responseBody = tryParseJson(data.body);
  }
  if (data.stdout) snapshot.stdout = cap(data.stdout);
  if (data.stderr) snapshot.stderr = cap(data.stderr, 1000);
  if (node.body) snapshot.requestBody = node.body;
  if (data.statusCode != null) snapshot.statusCode = data.statusCode;

  return {
    nodeId,
    type: node.type,
    label: nodeLabel(nodeId, node),
    ok: data.ok,
    error: data.error || null,
    statusCode: data.statusCode ?? null,
    stdout: data.stdout ? cap(data.stdout) : undefined,
    stderr: data.stderr ? cap(data.stderr, 1000) : undefined,
    body: data.body ? cap(data.body) : undefined,
    snapshot: Object.keys(snapshot).length ? snapshot : undefined,
    ms: data.ms,
  };
}

async function runHttpNode(
  buildDir: string,
  composeYaml: string,
  portMap: PortMap,
  node: ValidationGraphNode,
): Promise<{ ok: boolean; error?: string | null; statusCode: number; body: string }> {
  const externalPort = composeManager.resolveHostPortForService(composeYaml, node.service || '', portMap);
  if (externalPort == null) {
    const composeFields = composeManager.hostPortFieldsForComposeService(composeYaml, node.service || '');
    const hint = composeFields.length
      ? `compose publishes ${composeFields.map((f: string) => `\${${f}}`).join(', ')}`
      : 'no ${HOST_PORT_*} placeholder found for this service in docker-compose.yml';
    return {
      ok: false,
      error: `no allocated host port for service "${node.service}" (${hint})`,
      statusCode: 0,
      body: '',
    };
  }
  const url = `http://localhost:${externalPort}${node.path || '/'}`;
  const method = node.method || 'GET';
  const headers: Record<string, string> = { ...(node.headers || {}) };
  let fetchBody: string | undefined;
  if (node.body != null && method !== 'GET' && method !== 'HEAD') {
    if (!headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = 'application/json';
    }
    fetchBody = typeof node.body === 'string' ? node.body : JSON.stringify(node.body);
  }
  const res = await fetch(url, { method, headers, body: fetchBody }).catch((e: Error) => ({
    ok: false,
    status: 0,
    text: async () => `fetch failed: ${e.message}`,
  }));
  const statusCode = (res as Response).status || 0;
  const body = await (res as Response).text().catch(() => '');
  let ok = !!(res as Response).ok;
  let error: string | null = null;

  if (node.check) {
    const verdict = evaluateCheck({
      stdout: body,
      stderr: '',
      statusCode,
      httpOk: ok,
    }, node.check);
    ok = verdict.ok;
    error = verdict.error || null;
  }

  return { ok, error, statusCode, body };
}

async function runExecNode(
  buildDir: string,
  portMap: PortMap,
  node: ValidationGraphNode,
  { timeoutMs = DEFAULT_EXEC_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<{ ok: boolean; error?: string | null; stdout: string; stderr: string }> {
  const cmd = Array.isArray(node.cmd) ? node.cmd : [node.cmd as string];
  const execPromise = composeManager.exec(buildDir, node.service!, cmd, { portMap });
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    setTimeout(() => reject(new Error(`exec timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    const { stdout, stderr } = await Promise.race([execPromise, timeoutPromise]);
    let ok = true;
    let error: string | null = null;
    if (node.check) {
      const verdict = evaluateCheck({ stdout, stderr, statusCode: null, httpOk: false }, node.check);
      ok = verdict.ok;
      error = verdict.error || null;
    }
    return { ok, error, stdout, stderr };
  } catch (e) {
    const err = e as Record<string, unknown> & { message?: string };
    return {
      ok: false,
      error: (e as Error).message,
      stdout: String(err.stdout || ''),
      stderr: String(err.stderr || ''),
    };
  }
}

export function hasValidationGraph(
  validationSpec: {
    graph?: ValidationGraphSpec;
    graphs?: ValidationGraphEntry[];
    steps?: unknown[];
    version?: number;
  } | null | undefined,
): boolean {
  if (validationSpec?.graphs?.length) {
    return validationSpec.graphs.every(
      (g) => g?.graph?.entry && g.graph.nodes && Object.keys(g.graph.nodes).length > 0,
    );
  }
  if (!validationSpec?.graph) return false;
  const g = validationSpec.graph as ValidationGraphSpec;
  return !!(g.entry && g.nodes && typeof g.nodes === 'object' && Object.keys(g.nodes).length > 0);
}

export function getValidationGraphEntries(
  validationSpec: { graph?: ValidationGraphSpec; graphs?: ValidationGraphEntry[] } | null | undefined,
): ValidationGraphEntry[] {
  if (validationSpec?.graphs?.length) return validationSpec.graphs;
  if (validationSpec?.graph?.entry) {
    return [{
      symptomId: 0,
      symptomCheck: '(single graph — prefer validationSpec.graphs[] per symptom)',
      graph: validationSpec.graph,
    }];
  }
  return [];
}

/**
 * Run one DAG per design validationSymptom; aggregate snapshots for the judge.
 */
export async function runValidationGraphSuite({
  buildDir,
  portMap,
  entries,
  onNodeStart,
  onNodeComplete,
  onGraphStart,
}: {
  buildDir: string;
  portMap: PortMap;
  entries: ValidationGraphEntry[];
  onNodeStart?: (nodeId: string, label: string, ctx: { symptomId: number | string }) => void;
  onNodeComplete?: (snap: ValidationGraphNodeSnapshot) => void;
  onGraphStart?: (entry: ValidationGraphEntry, index: number, total: number) => void;
}): Promise<ValidationGraphSuiteResult> {
  const { content: composeYaml } = composeManager.readComposeFile(buildDir);
  const graphResults: ValidationGraphSuiteResult['graphs'] = [];
  const allSnapshots: ValidationGraphNodeSnapshot[] = [];
  const coverageGoals: string[] = [];
  let aborted = false;
  let abortReason: string | null = null;
  let expectBroken = true;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (aborted) break;
    onGraphStart?.(entry, i, entries.length);
    expectBroken = entry.graph.expectBroken !== false;

    // eslint-disable-next-line no-await-in-loop
    const result = await runValidationGraph({
      buildDir,
      composeYaml,
      portMap,
      graph: entry.graph,
      onNodeStart: onNodeStart
        ? (nodeId: string, label: string) => onNodeStart(nodeId, label, { symptomId: entry.symptomId })
        : undefined,
      onNodeComplete: (snap: ValidationGraphNodeSnapshot) => {
        const tagged = {
          ...snap,
          symptomId: entry.symptomId,
          symptomCheck: entry.symptomCheck,
        };
        allSnapshots.push(tagged);
        onNodeComplete?.(tagged);
      },
    });

    graphResults.push({
      ...result,
      symptomId: entry.symptomId,
      symptomCheck: entry.symptomCheck,
    });
    coverageGoals.push(
      ...(entry.graph.coverage?.brokenStateGoals || []),
      entry.symptomCheck,
    );

    if (result.aborted) {
      aborted = true;
      abortReason = `symptom ${entry.symptomId}: ${result.abortReason || 'graph aborted'}`;
    }
  }

  return {
    aborted,
    abortReason,
    expectBroken,
    graphs: graphResults,
    snapshots: allSnapshots,
    coverageGoals,
  };
}

/**
 * Run validation graph from entry until all paths complete or abort.
 */
export async function runValidationGraph({
  buildDir,
  composeYaml,
  portMap,
  graph,
  onNodeStart,
  onNodeComplete,
}: {
  buildDir: string;
  composeYaml?: string;
  portMap: PortMap;
  graph: ValidationGraphSpec;
  onNodeStart?: (nodeId: string, label: string) => void;
  onNodeComplete?: (snap: ValidationGraphNodeSnapshot) => void;
}): Promise<ValidationGraphRunResult> {
  const compose = composeYaml || composeManager.readComposeFile(buildDir).content;
  const snapshots: ValidationGraphNodeSnapshot[] = [];
  const nodeOutcomes: ValidationGraphRunResult['nodeOutcomes'] = {};
  const backgroundJobs = new Map<string, BackgroundJob>();
  let aborted = false;
  let abortReason: string | null = null;

  const record = (snap: ValidationGraphNodeSnapshot): void => {
    snapshots.push(snap);
    nodeOutcomes[snap.nodeId] = { ok: snap.ok, error: snap.error, ms: snap.ms };
    onNodeComplete?.(snap);
  };

  async function executeActionNode(nodeId: string, node: ValidationGraphNode): Promise<boolean> {
    onNodeStart?.(nodeId, nodeLabel(nodeId, node));
    const start = Date.now();

    if (node.type === 'http') {
      const result = await runHttpNode(buildDir, compose, portMap, node);
      const snap = buildSnapshotPayload(nodeId, node, { ...result, ms: Date.now() - start });
      record(snap);
      if (!result.ok && !node.optional) {
        if (node.onFail !== 'continue') {
          aborted = true;
          abortReason = snap.error || `node ${nodeId} failed`;
        }
      }
      return result.ok || node.optional === true || node.onFail === 'continue';
    }

    if (node.type === 'exec') {
      const result = await runExecNode(buildDir, portMap, node);
      const snap = buildSnapshotPayload(nodeId, node, { ...result, ms: Date.now() - start });
      record(snap);
      if (!result.ok && !node.optional) {
        if (node.onFail !== 'continue') {
          aborted = true;
          abortReason = snap.error || `node ${nodeId} failed`;
        }
      }
      return result.ok || node.optional === true || node.onFail === 'continue';
    }

    if (node.type === 'background') {
      let resolveJob!: () => void;
      const jobPromise = new Promise<void>((resolve) => { resolveJob = resolve; });
      backgroundJobs.set(nodeId, {
        nodeId,
        promise: jobPromise,
        stop: () => resolveJob(),
      });
      runExecNode(buildDir, portMap, node, { timeoutMs: 300_000 })
        .then((result) => {
          const snap = buildSnapshotPayload(nodeId, node, { ...result, ms: Date.now() - start });
          record(snap);
          resolveJob();
        })
        .catch((e: Error) => {
          const snap = buildSnapshotPayload(nodeId, node, {
            ok: false,
            error: e.message,
            stdout: '',
            stderr: '',
            ms: Date.now() - start,
          });
          record(snap);
          resolveJob();
        });
      return true;
    }

    return true;
  }

  async function runChain(fromId: string, stopAtId?: string): Promise<void> {
    let current: string | null = fromId;
    while (current && !aborted) {
      if (stopAtId && current === stopAtId) return;

      const node: ValidationGraphNode | undefined = graph.nodes[current];
      if (!node) {
        aborted = true;
        abortReason = `unknown graph node "${current}"`;
        return;
      }

      if (node.type === 'wait') {
        onNodeStart?.(current, nodeLabel(current, node));
        const ms = Math.max(0, Math.min(node.ms || 0, 60_000));
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => { setTimeout(r, ms); });
        const snap = buildSnapshotPayload(current, node, { ok: true, ms });
        record(snap);
      } else if (node.type === 'fork') {
        onNodeStart?.(current, nodeLabel(current, node));
        const joinId: string | undefined = node.join;
        const branches: string[] = node.branches || [];
        const snap = buildSnapshotPayload(current, node, { ok: true });
        record(snap);
        await Promise.all(branches.map((branchId: string) => runChain(branchId, joinId)));
        if (aborted) return;
        if (joinId) {
          current = joinId;
          continue;
        }
      } else if (node.type === 'join') {
        onNodeStart?.(current, nodeLabel(current, node));
        const waitIds: string[] = node.waitFor || [];
        await Promise.all(
          waitIds.map(async (id: string) => {
            const job = backgroundJobs.get(id);
            if (job) await job.promise;
          }),
        );
        const snap = buildSnapshotPayload(current, node, { ok: true });
        record(snap);
      } else if (node.type === 'stop') {
        onNodeStart?.(current, nodeLabel(current, node));
        for (const targetId of node.targets || []) {
          const job = backgroundJobs.get(targetId);
          job?.stop?.();
        }
        const snap = buildSnapshotPayload(current, node, { ok: true });
        record(snap);
      } else if (node.type === 'http' || node.type === 'exec' || node.type === 'background') {
        // eslint-disable-next-line no-await-in-loop
        await executeActionNode(current, node);
        if (aborted) return;
      } else {
        aborted = true;
        abortReason = `unsupported node type "${node.type}" at ${current}`;
        return;
      }

      const nextList: string[] = node.next || [];
      if (nextList.length === 0) return;
      if (nextList.length > 1) {
        await Promise.all(nextList.map((n: string) => runChain(n)));
        return;
      }
      current = nextList[0];
    }
  }

  await runChain(graph.entry);

  return {
    aborted,
    abortReason,
    expectBroken: graph.expectBroken !== false,
    snapshots,
    nodeOutcomes,
    coverageGoals: graph.coverage?.brokenStateGoals || [],
  };
}

module.exports = {
  hasValidationGraph,
  getValidationGraphEntries,
  runValidationGraph,
  runValidationGraphSuite,
};
