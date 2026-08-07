'use strict';

/**
 * Publish a verified Spark authoring workspace to the live catalog:
 *   - MinIO: challenges/<slug>/input, eval, starter
 *   - Postgres: challenges row (sandbox_type=spark-platform)
 */

import * as fs from 'fs';
import * as path from 'path';

import type { SparkShapeContract, SparkWorkspaceLayout } from '../../types/sparkShape';

const pool = require('../../db/pool');
const { getObjectStore, normalizeKey } = require('../../workspace/objectStore');
const { uploadDirToPrefix } = require('./uploadDir');

function s3a(key: string): string {
  const bucket = process.env.MINIO_BUCKET || process.env.S3_BUCKET || 'devlabs-data';
  return `s3a://${bucket}/${normalizeKey(key).replace(/^\/+/, '')}`;
}

async function publishSparkChallenge({
  contract,
  layout,
}: {
  contract: SparkShapeContract;
  layout: SparkWorkspaceLayout;
}): Promise<{
  challengeId: string;
  inputPrefix: string;
  evalKey: string;
  starterPrefix: string;
}> {
  const slug = contract.meta.slug;
  const inputPrefix = `challenges/${slug}/input/`;
  const evalKey = normalizeKey(
    contract.evalCollection.publishAs || `challenges/${slug}/eval/solution.json`,
  );
  const starterPrefix = `challenges/${slug}/starter/`;

  // Prefer Eval-populated input/; fall back empty
  if (fs.existsSync(layout.input) && fs.readdirSync(layout.input).length) {
    await uploadDirToPrefix(layout.input, inputPrefix, { replace: true });
  }

  const store = getObjectStore();
  const localEval = fs.existsSync(path.join(layout.eval, 'solution.json'))
    ? path.join(layout.eval, 'solution.json')
    : path.join(layout.eval, path.basename(evalKey));
  if (!fs.existsSync(localEval)) {
    throw Object.assign(new Error('eval/solution.json missing — run pipeline Eval first'), { status: 400 });
  }
  await store.putObject(evalKey, fs.readFileSync(localEval), 'application/json');

  if (fs.existsSync(layout.starter)) {
    await uploadDirToPrefix(layout.starter, starterPrefix, { replace: true });
  }

  const businessDate = contract.data.businessDate || '2026-01-15';
  const inputPath = s3a(`${inputPrefix}business_date=${businessDate}/`);
  const evalSolutionPath = s3a(evalKey);

  const platformSpec = {
    inputPath,
    evalSolutionPath,
    businessDate,
    language: contract.platform.language,
    starterFileName: contract.platform.starterFileName,
    starterPrefix: s3a(starterPrefix),
    limits: contract.platform.limits,
    gradeChecks: contract.platform.gradeChecks,
  };

  const now = Date.now();
  await pool.query(
    `INSERT INTO challenges
       (id, title, description, difficulty, tags, category,
        finalized, sandbox_type, verified_dir,
        problem_statement, validation_spec, platform_spec,
        created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,true,$7,NULL,$8,NULL,$9,$10,$10)
     ON CONFLICT (id) DO UPDATE SET
       title = EXCLUDED.title,
       description = EXCLUDED.description,
       difficulty = EXCLUDED.difficulty,
       tags = EXCLUDED.tags,
       category = EXCLUDED.category,
       finalized = true,
       sandbox_type = EXCLUDED.sandbox_type,
       problem_statement = EXCLUDED.problem_statement,
       platform_spec = EXCLUDED.platform_spec,
       updated_at = EXCLUDED.updated_at`,
    [
      slug,
      contract.meta.name,
      contract.brief.description,
      contract.meta.difficulty === 'easy'
        ? 'Easy'
        : contract.meta.difficulty === 'hard'
          ? 'Hard'
          : 'Medium',
      JSON.stringify(contract.meta.tags || []),
      contract.meta.category || 'batch-processing',
      'spark-platform',
      JSON.stringify(contract.brief.problemStatement || {}),
      JSON.stringify(platformSpec),
      now,
    ],
  );

  return {
    challengeId: slug,
    inputPrefix,
    evalKey,
    starterPrefix,
  };
}

module.exports = { publishSparkChallenge, s3a };
