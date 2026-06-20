'use strict';

/**
 * Devlabs scaffold invariants enforced after CODE (via verifyBuildComplete).
 * Ensures validationSpec.steps, readyServices, compose labels, etc.
 */

import * as fs from 'fs';
import * as path from 'path';

const composeManager = require('../../sandbox/composeManager');

const METRIC_RE = /METRIC\s+latency=/;

function readUtf8(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf8');
  } catch (_e) {
    return null;
  }
}

function walkFiles(dir: string, prefix: string, out: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    const st = fs.statSync(abs);
    if (st.isDirectory()) walkFiles(abs, rel, out);
    else if (st.isFile()) out.push(rel);
  }
}

function customServiceNames(composeYaml: string): string[] {
  return composeManager.extractBuildContexts(composeYaml).map(
    (c: { service: string }) => c.service,
  );
}

/**
 * Programmatic scaffold rule checks — replaces LLM self-verification greps.
 * Throws with a human-readable list of violations.
 */
export function verifyScaffoldRules(buildDir: string): void {
  const issues: string[] = [];
  const composePath = path.join(buildDir, 'docker-compose.yml');
  const challengePath = path.join(buildDir, 'challenge.json');

  const compose = readUtf8(composePath);
  const challengeRaw = readUtf8(challengePath);
  if (!compose) {
    issues.push('missing docker-compose.yml');
  }
  if (!challengeRaw) {
    issues.push('missing challenge.json');
  }
  if (issues.length) {
    throw new Error(`scaffold rules failed: ${issues.join('; ')}`);
  }

  let challenge: Record<string, unknown> = {};
  try {
    challenge = JSON.parse(challengeRaw as string);
  } catch (e) {
    issues.push(`challenge.json is not valid JSON: ${(e as Error).message}`);
  }

  // Host port placeholders
  const hostPortHits = (compose as string).match(/\$\{HOST_PORT_[A-Z0-9_]+\}/g) || [];
  if (hostPortHits.length === 0) {
    issues.push('docker-compose.yml: no ${HOST_PORT_*} placeholders found');
  }

  // devlabs.role labels
  const roleHits = (compose as string).match(/devlabs\.role/gi) || [];
  if (roleHits.length === 0) {
    issues.push('docker-compose.yml: no devlabs.role labels found');
  }

  // service_healthy on custom (built) services only
  for (const svc of customServiceNames(compose as string)) {
    const svcBlockRe = new RegExp(`(?:^|\\n)${svc}:[\\s\\S]*?(?=\\n[a-zA-Z0-9_.-]+:|$)`, 'm');
    const block = (compose as string).match(svcBlockRe)?.[0] || '';
    if (/condition:\s*service_healthy/i.test(block)) {
      issues.push(`docker-compose.yml: service "${svc}" uses condition: service_healthy (use service_started for custom services)`);
    }
  }

  // init/*.cql or sql — gc_grace_seconds when init.cql exists (Cassandra challenges)
  const initDir = path.join(buildDir, 'init');
  if (fs.existsSync(initDir)) {
    for (const file of fs.readdirSync(initDir)) {
      const abs = path.join(initDir, file);
      if (!fs.statSync(abs).isFile()) continue;
      const content = readUtf8(abs) || '';
      if (/\.cql$/i.test(file) && /CREATE\s+TABLE/i.test(content) && !/gc_grace_seconds/i.test(content)) {
        issues.push(`init/${file}: Cassandra table without gc_grace_seconds`);
      }
    }
  }

  // load-generator METRIC line
  const servicesDir = path.join(buildDir, 'services');
  const serviceFiles: string[] = [];
  walkFiles(servicesDir, 'services', serviceFiles);
  const generatorFiles = serviceFiles.filter((f) => f.includes('load-generator') && /\.(py|js|ts)$/i.test(f));
  if (generatorFiles.length > 0) {
    const hasMetric = generatorFiles.some((rel) => {
      const content = readUtf8(path.join(buildDir, rel)) || '';
      return METRIC_RE.test(content);
    });
    if (!hasMetric) {
      issues.push('services/load-generator: no "METRIC latency=" log line found');
    }
  }

  // challenge.json validationSpec
  const vs = challenge.validationSpec as Record<string, unknown> | undefined;
  const hasSteps = !!(vs && Array.isArray(vs.steps) && vs.steps.length > 0);
  const hasGraphs = !!(vs && Array.isArray(vs.graphs) && vs.graphs.length > 0
    && (vs.graphs as Array<{ graph?: { entry?: string; nodes?: unknown } }>).every(
      (g) => g?.graph?.entry && g.graph.nodes,
    ));
  const hasSingleGraph = !!(vs && vs.graph && typeof vs.graph === 'object'
    && (vs.graph as Record<string, unknown>).entry
    && (vs.graph as Record<string, unknown>).nodes);
  if (!hasSteps && !hasGraphs && !hasSingleGraph) {
    issues.push('challenge.json: validationSpec.steps or validationSpec.graphs (one DAG per symptom) is required');
  }
  if (!vs?.readyServices || !Array.isArray(vs.readyServices) || vs.readyServices.length === 0) {
    issues.push('challenge.json: validationSpec.readyServices is missing or empty');
  }

  if (issues.length > 0) {
    throw new Error(`scaffold rules failed: ${issues.join('; ')}`);
  }
}

module.exports = { verifyScaffoldRules };
