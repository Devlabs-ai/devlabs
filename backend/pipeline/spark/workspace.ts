'use strict';

/**
 * Workspace layout for a Spark authoring draft session.
 *
 *   <root>/
 *     gen/        ← Data Agent (generation scripts only)
 *     starter/    ← Code Agent (stub | broken) — candidate-facing
 *     solution/   ← Code Agent (implemented | fixed) — private
 *     input/      ← Eval Agent (after running gen)
 *     eval/       ← Eval Agent (collected golden)
 *     shape.json  ← locked contract
 */

import * as fs from 'fs';
import * as path from 'path';

import type { SparkWorkspaceLayout } from '../../types/sparkShape';

function sparkAuthoringRoot(draftSessionId: string): string {
  const base = process.env.SPARK_AUTHORING_DIR
    || path.join(__dirname, '../../../sandbox/spark-authoring');
  return path.resolve(base, draftSessionId);
}

function ensureSparkWorkspace(draftSessionId: string): SparkWorkspaceLayout {
  const root = sparkAuthoringRoot(draftSessionId);
  const layout: SparkWorkspaceLayout = {
    root,
    gen: path.join(root, 'gen'),
    starter: path.join(root, 'starter'),
    solution: path.join(root, 'solution'),
    input: path.join(root, 'input'),
    eval: path.join(root, 'eval'),
  };
  for (const dir of Object.values(layout)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return layout;
}

function writeShapeLock(layout: SparkWorkspaceLayout, contract: unknown): string {
  const p = path.join(layout.root, 'shape.json');
  fs.writeFileSync(p, `${JSON.stringify(contract, null, 2)}\n`, 'utf8');
  return p;
}

function readShapeLock(layout: SparkWorkspaceLayout): unknown | null {
  const p = path.join(layout.root, 'shape.json');
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

module.exports = {
  sparkAuthoringRoot,
  ensureSparkWorkspace,
  writeShapeLock,
  readShapeLock,
};
