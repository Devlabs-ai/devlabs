/**
 * Upload a quiz playground from platforms/devlabs-data/quizzes to MinIO.
 *
 * Usage (from backend/):
 *   DEVLABS_DATA_ROOT=../../platforms/devlabs-data \
 *     npx tsx scripts/publishQuizToMinio.ts --id quiz-spark-execution-basics
 *
 * Optional — run exhibit on Spark Platform first, write historyUrl into
 * metadata.json, then publish (refuses MinIO upload if the job fails):
 *   ... publishQuizToMinio.ts --id quiz-spark-execution-basics --run-exhibit
 */

import fs from 'fs';
import path from 'path';

require('dotenv').config({ override: true });

const { getObjectStore, normalizeKey } = require('../workspace/objectStore');
const { runQuizExhibit } = require('./runQuizExhibit');

function resolveDataRoot(): string {
  const fromEnv = process.env.DEVLABS_DATA_ROOT;
  if (fromEnv && fs.existsSync(fromEnv)) return path.resolve(fromEnv);
  const sibling = path.resolve(__dirname, '../../../platforms/devlabs-data');
  if (fs.existsSync(sibling)) return sibling;
  throw new Error('DEVLABS_DATA_ROOT not found (expected platforms/devlabs-data)');
}

function walkFiles(root: string): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    for (const name of fs.readdirSync(dir)) {
      if (name === '.DS_Store' || name === '__pycache__') continue;
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) stack.push(full);
      else if (st.isFile()) out.push(full);
    }
  }
  return out.sort();
}

function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.json') return 'application/json';
  if (ext === '.md') return 'text/markdown; charset=utf-8';
  if (ext === '.py') return 'text/x-python; charset=utf-8';
  if (ext === '.txt') return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}

async function main() {
  const args = process.argv.slice(2);
  const idFlag = args.indexOf('--id');
  if (idFlag < 0 || !args[idFlag + 1]) {
    console.error(
      'Usage: publishQuizToMinio.ts --id <quiz-id> [--run-exhibit]',
    );
    process.exit(1);
  }
  const quizId = args[idFlag + 1];
  const runExhibit = args.includes('--run-exhibit');
  const dataRoot = resolveDataRoot();
  const quizDir = path.join(dataRoot, 'quizzes', quizId);
  if (!fs.existsSync(quizDir)) {
    throw new Error(`missing quiz playground: ${quizDir}`);
  }

  const metaPath = path.join(quizDir, 'quiz.json');
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  if (meta.kind !== 'quiz') {
    throw new Error(`refusing to publish: kind=${JSON.stringify(meta.kind)} (expected quiz)`);
  }

  const hasExhibit = fs.existsSync(path.join(quizDir, 'exhibit', 'src', 'main.py'));
  if (runExhibit) {
    if (!hasExhibit) {
      throw new Error('--run-exhibit set but exhibit/src/main.py is missing');
    }
    console.log('==> run exhibit on Spark Platform (before MinIO publish)');
    const result = await runQuizExhibit(quizDir, quizId);
    console.log(`EXHIBIT_OK  app=${result.historyAppId}`);
    console.log(`EXHIBIT_OK  url=${result.historyUrl}`);
  } else if (hasExhibit) {
    console.log(
      'NOTE  exhibit present — pass --run-exhibit to capture History Server URL before publish',
    );
  }

  const prefix = `quizzes/${quizId}`;
  const store = getObjectStore();

  // Upload playground files (relative to quiz dir). Skip local scratch / captures.
  const files = walkFiles(quizDir).filter((full) => {
    const rel = path.relative(quizDir, full).split(path.sep).join('/');
    if (rel.startsWith('runs/')) return false;
    if (rel.startsWith('_docker_test/')) return false;
    if (rel.startsWith('_local_input/')) return false;
    if (rel === '.gitignore' || rel.endsWith('/.gitignore')) return false;
    return true;
  });
  let uploaded = 0;
  for (const full of files) {
    const rel = path.relative(quizDir, full).split(path.sep).join('/');
    const key = normalizeKey(`${prefix}/${rel}`);
    const body = fs.readFileSync(full);
    await store.putObject(key, body, contentTypeFor(full));
    console.log(`PUT  s3://…/${key} (${body.length} bytes)`);
    uploaded += 1;
  }

  const manifest = {
    id: quizId,
    kind: 'quiz',
    content_source: 'minio',
    learningOutcome: meta.learningOutcome || null,
    prefixes: {
      quiz: `${prefix}/quiz.json`,
      metadata: `${prefix}/metadata.json`,
      exhibit: `${prefix}/exhibit/`,
      questions: `${prefix}/questions.json`,
      brief: `${prefix}/quiz.md`,
      fixture: `${prefix}/fixture.md`,
    },
    publishedAt: new Date().toISOString(),
  };
  const manifestKey = normalizeKey(`${prefix}/manifest.json`);
  const manifestBody = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8');
  await store.putObject(manifestKey, manifestBody, 'application/json');
  console.log(`PUT  s3://…/${manifestKey}`);

  console.log(`DONE  quiz=${quizId} files=${uploaded + 1}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
