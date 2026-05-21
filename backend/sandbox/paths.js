'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Repo root in git checkout: <repo>/
 * App root in Docker image: /app/  (backend/ copied flat; sandbox/ mounted alongside)
 */
function appRoot() {
  const backendDir = path.resolve(__dirname, '..');
  if (fs.existsSync(path.join(backendDir, 'sandbox'))) {
    return backendDir;
  }
  return path.resolve(backendDir, '..');
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
