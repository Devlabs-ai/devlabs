'use strict';

/**
 * Build a navigable workspace tree with per-file objectives for CODE repair mode.
 * Derived server-side from disk + draft — zero LLM cost.
 */

import * as fs from 'fs';
import * as path from 'path';

import type { BuildAttempt, ChallengeDraft, DraftInfraService } from '../../types/domain';

const SPIN_LOG_REL = '.devlabs/spin-failure.log';

const FILE_PATH_RE = /(?:services\/[\w.-]+(?:\/[\w.-]+)+|(?:docker-compose|challenge)\.(?:yml|json)|init\/[\w.-]+|\.devlabs\/[\w.-]+)/gi;

export interface TreeFileNode {
  path: string;
  bytes: number;
  objective: string;
}

export interface TreeServiceNode {
  objective: string;
  files: TreeFileNode[];
}

export interface WorkspaceTree {
  root: TreeFileNode[];
  services: Record<string, TreeServiceNode>;
  init: TreeFileNode[];
}

export interface FailureContext {
  phase: string;
  message: string | null;
  likelyFiles: string[];
  likelyServices: string[];
  failedNodes?: Array<{ label: string; statusCode?: number; body?: string }>;
  actionHint?: string | null;
  fileSnippet?: { path: string; startLine: number; endLine: number; content: string };
  /** Concrete "good repair" steps for this failure — read failureContext first. */
  repairPlan?: {
    failure: string;
    targetFile: string | null;
    goodRepair: string[];
  };
}

const SNIPPET_MAX_LINES = 80;
const SNIPPET_MAX_CHARS = 6000;

function sortLikelyFiles(files: string[]): string[] {
  const score = (p: string): number => {
    if (/\/app\.(py|js|ts)$/.test(p)) return 0;
    if (p.endsWith('/Dockerfile')) return 1;
    if (p === 'challenge.json') return 2;
    if (p === 'docker-compose.yml') return 3;
    return 4;
  };
  return [...files].sort((a, b) => score(a) - score(b));
}

function readFileSnippet(buildDir: string, relPath: string): FailureContext['fileSnippet'] | undefined {
  try {
    const abs = path.join(buildDir, relPath);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return undefined;
    const lines = fs.readFileSync(abs, 'utf8').split('\n');
    const endLine = Math.min(SNIPPET_MAX_LINES, lines.length);
    let content = lines.slice(0, endLine).join('\n');
    if (content.length > SNIPPET_MAX_CHARS) {
      content = `${content.slice(0, SNIPPET_MAX_CHARS)}\n…[snippet truncated]`;
    }
    return { path: relPath, startLine: 1, endLine, content };
  } catch {
    return undefined;
  }
}

function buildRepairPlan({
  phase,
  message,
  likelyFiles,
  failedNodes,
  actionHint,
  fileSnippet,
}: {
  phase: string;
  message: string | null;
  likelyFiles: string[];
  failedNodes?: FailureContext['failedNodes'];
  actionHint?: string | null;
  fileSnippet?: FailureContext['fileSnippet'];
}): FailureContext['repairPlan'] {
  const targetFile = likelyFiles.find((p) => /\/app\.(py|js|ts)$/.test(p))
    || likelyFiles[0]
    || null;

  let failure = message || actionHint || `${phase} failure — see previousAttempt.message and details`;
  if (failedNodes?.length) {
    const node = failedNodes[0];
    const status = node.statusCode ? ` (HTTP ${node.statusCode})` : '';
    const body = (node.body || '').toLowerCase();
    if (body.includes('decimal') && body.includes('json')) {
      failure = `fix Decimal / JSON on ${node.label}`;
    } else {
      failure = `fix ${node.label}${status}`;
    }
  } else if (actionHint && /decimal/i.test(actionHint) && /json/i.test(actionHint)) {
    failure = 'fix Decimal / JSON serialization in the failing GET handler';
  }

  const hasSnippet = !!(fileSnippet && targetFile && fileSnippet.path === targetFile);
  const readStep = hasSnippet
    ? `skip read — failureContext.fileSnippet already contains ${targetFile}`
    : targetFile
      ? `one read of ${targetFile} (or skip if fileSnippet is present)`
      : 'one read of failureContext.likelyFiles[0]';

  let editStep = targetFile
    ? `edit_file on the failing handler in ${targetFile}`
    : 'edit_file on failureContext.likelyFiles[0]';
  if (failure.toLowerCase().includes('decimal') && targetFile?.endsWith('.py')) {
    editStep = `edit_file on get_product / serialize_product (or equivalent) in ${targetFile}`;
  } else if (phase === 'SPIN' && targetFile?.endsWith('Dockerfile')) {
    editStep = `edit_file or write_file on ${targetFile} (build/runtime fix)`;
  } else if (phase === 'CODE' && targetFile === 'docker-compose.yml') {
    editStep = 'edit_file on docker-compose.yml (ports, services, volumes per error message)';
  }

  return {
    failure,
    targetFile,
    goodRepair: [readStep, editStep, 'stop with a text summary — no more tool calls'],
  };
}

function fileBytes(buildDir: string, rel: string): number {
  try {
    const abs = path.join(buildDir, rel);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return fs.statSync(abs).size;
  } catch {
    /* ignore */
  }
  return 0;
}

function normalizeInfraService(s: string | DraftInfraService): DraftInfraService {
  if (typeof s === 'string') return { name: s };
  return s;
}

function fileObjective(relPath: string): string {
  const base = path.basename(relPath);
  if (base === 'Dockerfile') return 'Container build definition';
  if (base === 'docker-compose.yml') {
    return 'Orchestration — service wiring, HOST_PORT placeholders, devlabs.role labels';
  }
  if (base === 'challenge.json') {
    return 'Validation manifest — validationSpec.graphs, readyServices, terminalService';
  }
  if (/^app\.(py|js|ts|go)$/.test(base)) return 'Application entrypoint';
  if (base === 'package.json') return 'Node.js dependencies';
  if (base === 'requirements.txt') return 'Python dependencies';
  if (base === 'prometheus.yml') return 'Prometheus scrape configuration';
  if (relPath.startsWith('init/')) return 'Database/bootstrap seed script';
  return 'Service support file';
}

/** Lightweight compose scan — devlabs.role, build vs image per service block. */
function parseComposeServiceMeta(
  composeRaw: string,
): Record<string, { role?: string; hasBuild?: boolean; image?: string }> {
  const meta: Record<string, { role?: string; hasBuild?: boolean; image?: string }> = {};
  let current: string | null = null;
  for (const line of composeRaw.split('\n')) {
    const svcMatch = line.match(/^  ([a-zA-Z0-9][a-zA-Z0-9_-]*):\s*$/);
    if (svcMatch) {
      current = svcMatch[1];
      meta[current] = meta[current] || {};
      continue;
    }
    if (!current) continue;
    const roleMatch = line.match(/devlabs\.role:\s*(\S+)/);
    if (roleMatch) meta[current].role = roleMatch[1];
    if (/^\s+build:/.test(line)) meta[current].hasBuild = true;
    const imgMatch = line.match(/^\s+image:\s*(.+)$/);
    if (imgMatch) meta[current].image = imgMatch[1].trim();
  }
  return meta;
}

function serviceObjective(
  name: string,
  draftSvc: DraftInfraService | undefined,
  composeMeta: { role?: string; hasBuild?: boolean; image?: string } | undefined,
  inValidation: boolean,
): string {
  const parts: string[] = [];
  const role = composeMeta?.role || draftSvc?.roles?.[0] || 'service';
  parts.push(`${role} role`);
  if (draftSvc?.image_hint) parts.push(`image_hint: ${draftSvc.image_hint}`);
  else if (composeMeta?.image) parts.push(`image: ${composeMeta.image}`);
  if (composeMeta?.hasBuild) parts.push(`built from services/${name}`);
  if (draftSvc?.notes) parts.push(draftSvc.notes);
  if (inValidation) parts.push('referenced in validationSpec');
  return parts.join(' — ');
}

function collectValidationServices(challenge: Record<string, unknown> | null): Set<string> {
  const out = new Set<string>();
  if (!challenge) return out;
  const vs = challenge.validationSpec as Record<string, unknown> | undefined;
  if (!vs) return out;
  if (Array.isArray(vs.readyServices)) {
    for (const s of vs.readyServices) if (typeof s === 'string') out.add(s);
  }
  if (typeof vs.terminalService === 'string') out.add(vs.terminalService);
  if (typeof vs.metricsService === 'string') out.add(vs.metricsService);
  if (Array.isArray(vs.graphs)) {
    for (const g of vs.graphs as Array<{ graph?: { nodes?: Record<string, { service?: string }> } }>) {
      const nodes = g.graph?.nodes;
      if (!nodes) continue;
      for (const n of Object.values(nodes)) {
        if (n?.service) out.add(n.service);
      }
    }
  }
  if (Array.isArray(vs.steps)) {
    for (const st of vs.steps as Array<{ service?: string }>) {
      if (st.service) out.add(st.service);
    }
  }
  return out;
}

/** Walk buildDir + draft and produce tree with objectives for repair navigation. */
export function buildWorkspaceTree(buildDir: string, draft: ChallengeDraft): WorkspaceTree | null {
  if (!fs.existsSync(buildDir)) return null;

  let composeRaw = '';
  let challenge: Record<string, unknown> | null = null;
  const composePath = path.join(buildDir, 'docker-compose.yml');
  const challengePath = path.join(buildDir, 'challenge.json');
  if (fs.existsSync(composePath)) composeRaw = fs.readFileSync(composePath, 'utf8');
  if (fs.existsSync(challengePath)) {
    try {
      challenge = JSON.parse(fs.readFileSync(challengePath, 'utf8'));
    } catch {
      /* ignore */
    }
  }

  const composeMeta = composeRaw ? parseComposeServiceMeta(composeRaw) : {};
  const validationServices = collectValidationServices(challenge);

  const draftServices = new Map<string, DraftInfraService>();
  for (const s of draft.infra?.services || []) {
    const d = normalizeInfraService(s);
    if (d.name) draftServices.set(d.name, d);
  }

  const allServiceNames = new Set<string>([
    ...Object.keys(composeMeta),
    ...draftServices.keys(),
    ...validationServices,
  ]);

  const root: TreeFileNode[] = [];
  if (fs.existsSync(composePath)) {
    root.push({
      path: 'docker-compose.yml',
      bytes: fileBytes(buildDir, 'docker-compose.yml'),
      objective: fileObjective('docker-compose.yml'),
    });
  }
  if (fs.existsSync(challengePath)) {
    root.push({
      path: 'challenge.json',
      bytes: fileBytes(buildDir, 'challenge.json'),
      objective: fileObjective('challenge.json'),
    });
  }
  const spinLog = path.join(buildDir, SPIN_LOG_REL);
  if (fs.existsSync(spinLog)) {
    root.push({
      path: SPIN_LOG_REL,
      bytes: fs.statSync(spinLog).size,
      objective: 'Full SPIN container logs — read when extractedErrors is insufficient',
    });
  }

  const services: Record<string, TreeServiceNode> = {};
  for (const name of allServiceNames) {
    const draftSvc = draftServices.get(name);
    const cm = composeMeta[name];
    services[name] = {
      objective: serviceObjective(name, draftSvc, cm, validationServices.has(name)),
      files: [],
    };
  }

  const servicesDir = path.join(buildDir, 'services');
  if (fs.existsSync(servicesDir)) {
    for (const svcName of fs.readdirSync(servicesDir)) {
      const svcPath = path.join(servicesDir, svcName);
      if (!fs.statSync(svcPath).isDirectory()) continue;
      if (!services[svcName]) {
        services[svcName] = {
          objective: serviceObjective(svcName, undefined, composeMeta[svcName], validationServices.has(svcName)),
          files: [],
        };
      }
      for (const file of fs.readdirSync(svcPath)) {
        const fpath = path.join(svcPath, file);
        if (!fs.statSync(fpath).isFile()) continue;
        const rel = `services/${svcName}/${file}`;
        services[svcName].files.push({
          path: rel,
          bytes: fs.statSync(fpath).size,
          objective: fileObjective(rel),
        });
      }
    }
  }

  const init: TreeFileNode[] = [];
  const initDir = path.join(buildDir, 'init');
  if (fs.existsSync(initDir)) {
    for (const file of fs.readdirSync(initDir)) {
      const fpath = path.join(initDir, file);
      if (!fs.statSync(fpath).isFile()) continue;
      init.push({
        path: `init/${file}`,
        bytes: fs.statSync(fpath).size,
        objective: fileObjective(`init/${file}`),
      });
    }
  }

  return { root, services, init };
}

function extractPathsFromText(text: string, out: Set<string>): void {
  if (!text) return;
  const re = new RegExp(FILE_PATH_RE.source, 'gi');
  let m: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((m = re.exec(text)) !== null) {
    out.add(m[0].replace(/^\/+/, ''));
  }
}

/** Derive phase, message, and likely file/service targets from previousAttempt. */
export function buildFailureContext({
  previousAttempt,
  workspaceTree,
  buildDir,
}: {
  previousAttempt?: BuildAttempt | null;
  workspaceTree?: WorkspaceTree | null;
  buildDir?: string;
}): FailureContext | null {
  if (!previousAttempt?.phase) return null;

  const phase = String(previousAttempt.phase).toUpperCase();
  let message: string | null = previousAttempt.message || null;
  const textParts: string[] = [];
  const likelyFiles = new Set<string>();
  const likelyServices = new Set<string>();
  const d = previousAttempt.details as Record<string, unknown> | null | undefined;

  textParts.push(message || '');

  if (phase === 'SPIN') {
    if (Array.isArray(d?.extractedErrors)) {
      textParts.push(...(d.extractedErrors as string[]));
    }
    if (typeof d?.psSnapshot === 'string' && d.psSnapshot) {
      textParts.push(d.psSnapshot);
    }
  } else if (phase === 'VALIDATE') {
    if (Array.isArray(d?.suggestions)) {
      textParts.push(...(d.suggestions as string[]));
    }
    if (Array.isArray(d?.evidence)) {
      for (const ev of d.evidence as Array<Record<string, unknown>>) {
        if (ev.ok === true) continue;
        const label = typeof ev.label === 'string' ? ev.label : '';
        const body = typeof ev.body === 'string' ? ev.body : '';
        if (label) textParts.push(label);
        if (body) textParts.push(body);
        const svcFromLabel = label.match(/(?:GET|PUT|POST|PATCH|DELETE)\s+([\w-]+)\//i);
        if (svcFromLabel) likelyServices.add(svcFromLabel[1]);
      }
    }
  }

  for (const part of textParts) extractPathsFromText(part, likelyFiles);

  if (workspaceTree) {
    const corpus = textParts.join('\n').toLowerCase();
    for (const name of Object.keys(workspaceTree.services)) {
      if (corpus.includes(name.toLowerCase())) likelyServices.add(name);
    }
    for (const svc of likelyServices) {
      const node = workspaceTree.services[svc];
      if (!node) continue;
      for (const f of node.files) {
        if (f.path.endsWith('Dockerfile') || /\/app\.(py|js|ts)$/.test(f.path)) {
          likelyFiles.add(f.path);
        }
      }
    }
    if (phase === 'VALIDATE' || phase === 'CODE') likelyFiles.add('challenge.json');
    if (phase === 'SPIN' || phase === 'CODE') likelyFiles.add('docker-compose.yml');
  }

  if (!message && likelyFiles.size === 0 && likelyServices.size === 0) return null;

  const failedNodes: FailureContext['failedNodes'] = [];
  if (phase === 'VALIDATE' && Array.isArray(d?.evidence)) {
    for (const ev of d.evidence as Array<Record<string, unknown>>) {
      if (ev.ok === true) continue;
      failedNodes.push({
        label: typeof ev.label === 'string' ? ev.label : 'unknown',
        statusCode: typeof ev.statusCode === 'number' ? ev.statusCode : undefined,
        body: typeof ev.body === 'string' ? ev.body.slice(0, 500) : undefined,
      });
    }
  }

  const corpus = textParts.join('\n').toLowerCase();
  let actionHint: string | null = null;
  if (phase === 'VALIDATE' && corpus.includes('decimal') && corpus.includes('json')) {
    actionHint = 'Fix Decimal JSON serialization in the failing GET handler (likely services/api-service/app.py) — validation cannot observe the cache bug until GET returns 200.';
  } else if (phase === 'VALIDATE' && failedNodes.length) {
    actionHint = `Edit the service handler for failed node "${failedNodes[0].label}" — prefer Edit on the existing app file; do not only read files.`;
  } else if (
    phase === 'CODE'
    && /validationSpec\.graphs|graph\.entry|setup\/perturb|scaffold rules failed.*validationSpec/i.test(message || '')
  ) {
    actionHint = 'Use validationSpecTemplate from the CODE payload — copy into challenge.json validationSpec. HTTP nodes need service + path (not url/HOST_PORT); exec uses cmd array.';
    likelyFiles.add('challenge.json');
  } else if (
    phase === 'VALIDATE'
    && (/service "undefined"|GET undefined\//i.test(message || '') || /no allocated host port for service "undefined"/i.test(corpus))
  ) {
    actionHint = 'validationSpec.graph HTTP nodes must use service + path (not url or HOST_PORT placeholders). Edit challenge.json graph.nodes — e.g. { "service": "products-service", "path": "/products/1" }.';
    likelyFiles.add('challenge.json');
  }

  const priorCodeNoEdit = phase === 'CODE'
    && /without editing|no edits|read-only/i.test(previousAttempt.message || '');
  if (priorCodeNoEdit) {
    const retryHint = 'Previous CODE repair made 0 file edits — apply Edit on the primary service app file immediately (use failureContext.fileSnippet if present; do not re-read the same file).';
    actionHint = actionHint ? `${actionHint} ${retryHint}` : retryHint;
  }

  const likelyFilesSorted = sortLikelyFiles([...likelyFiles]);
  let fileSnippet: FailureContext['fileSnippet'];
  if (buildDir && likelyFilesSorted.length) {
    fileSnippet = readFileSnippet(buildDir, likelyFilesSorted[0]);
  }

  const repairPlan = buildRepairPlan({
    phase,
    message,
    likelyFiles: likelyFilesSorted,
    failedNodes: failedNodes.length ? failedNodes : undefined,
    actionHint,
    fileSnippet,
  });

  return {
    phase,
    message,
    likelyFiles: likelyFilesSorted,
    likelyServices: [...likelyServices],
    ...(failedNodes.length ? { failedNodes } : {}),
    ...(actionHint ? { actionHint } : {}),
    ...(fileSnippet ? { fileSnippet } : {}),
    repairPlan,
  };
}

module.exports = {
  buildWorkspaceTree,
  buildFailureContext,
};
