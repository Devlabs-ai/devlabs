'use strict';

/**
 * Post-CODE verification — layout, Devlabs scaffold rules, Dockerfile COPY, compose volumes.
 * Called by codeAgent after the LLM tool loop completes.
 */

import * as fs from 'fs';
import * as path from 'path';

const composeManager = require('../../sandbox/composeManager');
const { verifyScaffoldRules } = require('./scaffoldRules');

function readUtf8(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf8');
  } catch (_e) {
    return null;
  }
}

function listDockerfiles(buildDir: string): Array<{ service: string; relPath: string; absPath: string }> {
  const out: Array<{ service: string; relPath: string; absPath: string }> = [];
  const servicesDir = path.join(buildDir, 'services');
  if (!fs.existsSync(servicesDir)) return out;
  for (const svc of fs.readdirSync(servicesDir)) {
    const svcDir = path.join(servicesDir, svc);
    if (!fs.statSync(svcDir).isDirectory()) continue;
    const df = path.join(svcDir, 'Dockerfile');
    if (fs.existsSync(df)) {
      out.push({ service: svc, relPath: `services/${svc}/Dockerfile`, absPath: df });
    }
  }
  return out;
}

function parseCopySources(dockerfile: string, contextDir: string): string[] {
  const missing: string[] = [];
  const lines = dockerfile.split('\n');
  for (const line of lines) {
    const m = line.match(/^\s*COPY\s+(.+)$/i);
    if (!m) continue;
    const tokens = m[1].trim().split(/\s+/);
    if (tokens.length < 2) continue;
    const dest = tokens[tokens.length - 1];
    const sources = tokens.slice(0, -1);
    for (const src of sources) {
      if (src.startsWith('--')) continue;
      const rel = src.replace(/^\.\//, '');
      const abs = path.resolve(contextDir, rel);
      if (!fs.existsSync(abs)) {
        missing.push(rel);
      }
    }
    void dest;
  }
  return missing;
}

function verifyDockerfileCopyTargets(buildDir: string, issues: string[]): void {
  for (const { service, relPath, absPath } of listDockerfiles(buildDir)) {
    const content = readUtf8(absPath);
    if (!content) continue;
    const ctxDir = path.dirname(absPath);
    const missing = parseCopySources(content, ctxDir);
    for (const m of missing) {
      issues.push(`${relPath}: COPY references missing file "${m}" in services/${service}/`);
    }
    if (/npm\s+ci\b/i.test(content) && !fs.existsSync(path.join(ctxDir, 'package-lock.json'))) {
      issues.push(
        `${relPath}: uses "npm ci" but package-lock.json is missing — use "npm install" or add package-lock.json`,
      );
    }
  }
}

function verifyComposeVolumePaths(buildDir: string, composeYaml: string, issues: string[]): void {
  const volRe = /-\s*\.\/([^:\s]+):/g;
  let m: RegExpExecArray | null;
  while ((m = volRe.exec(composeYaml)) !== null) {
    const rel = m[1];
    const abs = path.join(buildDir, rel);
    if (!fs.existsSync(abs)) {
      issues.push(`docker-compose.yml: volume mount ./${rel} does not exist on disk`);
    }
  }
}

/**
 * Verify docker-compose.yml + challenge.json exist and build contexts are on disk.
 */
export function verifyBuildLayout(buildDir: string): void {
  const issues: string[] = [];
  const composePath = path.join(buildDir, 'docker-compose.yml');
  const challengePath = path.join(buildDir, 'challenge.json');

  if (!fs.existsSync(composePath)) issues.push('missing docker-compose.yml');
  if (!fs.existsSync(challengePath)) issues.push('missing challenge.json');
  if (issues.length) {
    throw new Error(`build layout incomplete: ${issues.join('; ')}`);
  }

  const composeYaml = fs.readFileSync(composePath, 'utf8');
  const buildCtxs: Array<{ service: string; contextPath: string }> = composeManager.extractBuildContexts(composeYaml);
  for (const { service, contextPath } of buildCtxs) {
    const ctxAbs = path.resolve(buildDir, contextPath);
    if (!ctxAbs.startsWith(`${buildDir}${path.sep}`) && ctxAbs !== buildDir) {
      issues.push(`service "${service}": build.context "${contextPath}" escapes the build dir`);
      continue;
    }
    if (!fs.existsSync(ctxAbs) || !fs.statSync(ctxAbs).isDirectory()) {
      issues.push(`service "${service}": build.context "${contextPath}" — directory does not exist`);
      continue;
    }
    if (!fs.existsSync(path.join(ctxAbs, 'Dockerfile'))) {
      issues.push(`service "${service}": build.context "${contextPath}" — Dockerfile missing`);
    }
  }

  if (issues.length > 0) {
    throw new Error(
      `compose references build contexts that don't exist on disk: ${issues.join('; ')}. `
      + 'Use build.context: ./services/<service-name> for each built service.',
    );
  }
}

/**
 * Full post-CODE check: layout, scaffold rules, Dockerfile COPY targets, volume mounts.
 */
export function verifyBuildComplete(buildDir: string, { scaffoldRules = true }: { scaffoldRules?: boolean } = {}): void {
  const issues: string[] = [];

  try {
    verifyBuildLayout(buildDir);
  } catch (e) {
    issues.push((e as Error).message);
  }

  if (scaffoldRules) {
    try {
      verifyScaffoldRules(buildDir);
    } catch (e) {
      issues.push((e as Error).message);
    }
  }

  const composePath = path.join(buildDir, 'docker-compose.yml');
  const composeYaml = readUtf8(composePath);
  if (composeYaml) {
    verifyComposeVolumePaths(buildDir, composeYaml, issues);
  }
  verifyDockerfileCopyTargets(buildDir, issues);

  if (issues.length > 0) {
    throw new Error(`build verification failed: ${issues.join('; ')}`);
  }
}

module.exports = {
  verifyBuildLayout,
  verifyBuildComplete,
};
