'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Repo root in git checkout: <repo>/  (sandbox/verified, sandbox/sessions)
 * App root in Docker image: /app/  (backend/ copied flat; sandbox/ mounted alongside)
 *
 * backend/sandbox/ holds runtime JS (composeManager, etc.) — not the data root.
 */
function appRoot() {
  const backendDir = path.resolve(__dirname, '..');
  const repoRoot = path.resolve(backendDir, '..');
  if (fs.existsSync(path.join(repoRoot, 'sandbox', 'verified'))) {
    return repoRoot;
  }
  if (fs.existsSync(path.join(backendDir, 'sandbox', 'verified'))) {
    return backendDir;
  }
  return repoRoot;
}

const SANDBOX_ROOT = path.join(appRoot(), 'sandbox');
const VERIFIED_ROOT = path.join(SANDBOX_ROOT, 'verified');
const BUILDS_ROOT = path.join(SANDBOX_ROOT, 'builds');
const SESSIONS_ROOT = path.join(SANDBOX_ROOT, 'sessions');

module.exports = {
  appRoot,
  SANDBOX_ROOT,
  VERIFIED_ROOT,
  BUILDS_ROOT,
  SESSIONS_ROOT,
};
