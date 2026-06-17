#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function walk(dir, predicate, results = []) {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, predicate, results);
    else if (predicate(full)) results.push(full);
  }
  return results;
}

function updateImports(content, isFrontend) {
  let next = content;
  next = next.replace(/from\s+(['"])([^'"]+)\.jsx\1/g, "from $1$2$1");
  next = next.replace(/from\s+(['"])([^'"]+)\.js\1/g, "from $1$2$1");
  next = next.replace(/import\s+(['"])([^'"]+)\.jsx\1/g, "import $1$2$1");
  next = next.replace(/import\s+(['"])([^'"]+)\.js\1/g, "import $1$2$1");
  if (isFrontend) {
    next = next.replace(/\.jsx(['"])/g, '$1');
    next = next.replace(/(?<!\.d)\.js(['"])/g, '$1');
  }
  return next;
}

function migrateDir(root, { fromExt, toExt, isFrontend }) {
  const files = walk(root, (f) => f.endsWith(fromExt));
  for (const file of files) {
    const target = file.slice(0, -fromExt.length) + toExt;
    let content = fs.readFileSync(file, 'utf8');
    content = updateImports(content, isFrontend);
    fs.writeFileSync(target, content, 'utf8');
    fs.unlinkSync(file);
    console.log(`${path.relative(process.cwd(), file)} -> ${path.relative(process.cwd(), target)}`);
  }
}

const repoRoot = path.resolve(__dirname, '..');

console.log('Migrating backend...');
migrateDir(path.join(repoRoot, 'backend'), { fromExt: '.js', toExt: '.ts', isFrontend: false });

console.log('Migrating frontend src...');
migrateDir(path.join(repoRoot, 'frontend/src'), { fromExt: '.jsx', toExt: '.tsx', isFrontend: true });
migrateDir(path.join(repoRoot, 'frontend/src'), { fromExt: '.js', toExt: '.ts', isFrontend: true });

const oldViteConfig = path.join(repoRoot, 'frontend/vite.config.js');
if (fs.existsSync(oldViteConfig)) {
  fs.unlinkSync(oldViteConfig);
  console.log('Removed frontend/vite.config.js');
}

console.log('Migration complete.');
