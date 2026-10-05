'use strict';

/**
 * Cluster labs: challenges that run on the EKS lab cluster and share the
 * `kubernetes` session runtime (lease, idle, grade, terminal). The flavor comes
 * from the pack's sandboxType:
 *   kubernetes — learner namespace ns-<user>, kubectl-only shell
 *   linux      — one systemd machine (pod `box`) in lx-<user>, shell inside it
 *   docker     — the same machine plus dockerd (pod `box`) in dk-<user>
 * linux and docker are "box" labs (workspace/linuxBox).
 */

import type { BoxFlavor } from '../types/domain';

const fs = require('fs');
const path = require('path');

const CLUSTER_LAB_TYPES = new Set(['kubernetes', 'linux', 'docker']);
const BOX_FLAVORS = new Set<string>(['linux', 'docker']);

function isClusterLabType(sandboxType: unknown): boolean {
  return CLUSTER_LAB_TYPES.has(String(sandboxType || ''));
}

/** linux / docker: the learner works on one machine, not in a namespace. */
function isBoxLabType(sandboxType: unknown): boolean {
  return BOX_FLAVORS.has(String(sandboxType || ''));
}

function boxFlavor(sandboxType: unknown): BoxFlavor | null {
  const t = String(sandboxType || '');
  return BOX_FLAVORS.has(t) ? (t as BoxFlavor) : null;
}

/** backend/challenges/<linux|docker|k8s>/<id>: setup.sh, grade.sh, solution/. */
function labPackDir(challengeId: string): string {
  for (const track of ['linux', 'docker']) {
    const dir = path.join(__dirname, track, challengeId);
    if (fs.existsSync(dir)) return dir;
  }
  return path.join(__dirname, 'k8s', challengeId);
}

module.exports = {
  isClusterLabType,
  isBoxLabType,
  boxFlavor,
  labPackDir,
};
