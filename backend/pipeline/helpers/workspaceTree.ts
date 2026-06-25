'use strict';

/**
 * Build a navigable workspace tree with per-file objectives for CODE repair mode.
 * Derived server-side from disk + draft — zero LLM cost.
 */

import * as fs from 'fs';
import * as path from 'path';

import type { ChallengeDraft, DraftInfraService } from '../../types/domain';

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

/** Derive phase, message, and likely file/service targets from failure signals. */
export function buildFailureContext({
  spinFailureMsg,
  validateFailureMsg,
  previousAttempt,
  workspaceTree,
}: {
  spinFailureMsg?: Record<string, unknown> | null;
  validateFailureMsg?: Record<string, unknown> | null;
  previousAttempt?: { phase?: string; message?: string } | null;
  workspaceTree?: WorkspaceTree | null;
}): FailureContext | null {
  let phase = 'CODE';
  let message: string | null = null;
  const textParts: string[] = [];
  const likelyFiles = new Set<string>();
  const likelyServices = new Set<string>();

  if (spinFailureMsg) {
    phase = 'SPIN';
    message = typeof spinFailureMsg.message === 'string' ? spinFailureMsg.message : null;
    textParts.push(message || '');
    if (Array.isArray(spinFailureMsg.extractedErrors)) {
      textParts.push(...(spinFailureMsg.extractedErrors as string[]));
    }
  } else if (validateFailureMsg) {
    phase = 'VALIDATE';
    message = typeof validateFailureMsg.message === 'string' ? validateFailureMsg.message : null;
    textParts.push(message || '');
    if (Array.isArray(validateFailureMsg.suggestions)) {
      textParts.push(...(validateFailureMsg.suggestions as string[]));
    }
    if (Array.isArray(validateFailureMsg.evidence)) {
      for (const ev of validateFailureMsg.evidence as Array<Record<string, unknown>>) {
        if (ev.ok === true) continue;
        const label = typeof ev.label === 'string' ? ev.label : '';
        const body = typeof ev.body === 'string' ? ev.body : '';
        if (label) textParts.push(label);
        if (body) textParts.push(body);
        const svcFromLabel = label.match(/(?:GET|PUT|POST|PATCH|DELETE)\s+([\w-]+)\//i);
        if (svcFromLabel) likelyServices.add(svcFromLabel[1]);
      }
    }
  } else if (previousAttempt?.phase) {
    phase = String(previousAttempt.phase);
    message = previousAttempt.message || null;
    textParts.push(message || '');
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
  if (Array.isArray(validateFailureMsg?.evidence)) {
    for (const ev of validateFailureMsg.evidence as Array<Record<string, unknown>>) {
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
    actionHint = `Edit the service handler for failed node "${failedNodes[0].label}" — do not only read files; apply edit_file.`;
  }

  return {
    phase,
    message,
    likelyFiles: [...likelyFiles],
    likelyServices: [...likelyServices],
    ...(failedNodes.length ? { failedNodes } : {}),
    ...(actionHint ? { actionHint } : {}),
  };
}

module.exports = {
  buildWorkspaceTree,
  buildFailureContext,
};
