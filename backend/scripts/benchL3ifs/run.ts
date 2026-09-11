#!/usr/bin/env npx tsx
/**
 * Submit Lab 18 approach variants and poll History for outcomes.
 *
 *   npx tsx backend/scripts/benchL3ifs/run.ts week_key broadcast repartition
 *   npx tsx backend/scripts/benchL3ifs/run.ts --all
 */
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env'), override: true });

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const pool = require('../../db/pool');
const { getObjectStore } = require('../../workspace/objectStore');
const sparkJobs = require('../../workspace/sparkJobs');

const CHALLENGE_ID = 'l3-interchange-fee-settlement';
const ALL_VARIANTS = [
  'week_key',
  'broadcast',
  'repartition',
  'aqe_skew',
  'hot_split',
  'filtered_naive',
  'salted_no_filter',
];

const APPROACH_PY = fs.readFileSync(path.join(__dirname, 'approach.py'), 'utf8');

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function historyMetrics(appId: string): Promise<{
  status: string;
  wallMs: number | null;
  failedTasks: number;
}> {
  const base = process.env.SPARK_HISTORY_BASE || 'http://192.168.1.2:30080';
  const jobsUrl = `${base}/api/v1/applications/${appId}/jobs`;
  const res = await fetch(jobsUrl);
  if (!res.ok) return { status: 'unknown', wallMs: null, failedTasks: 0 };
  const jobs = (await res.json()) as Array<{
    status: string;
    submissionTime: string;
    completionTime?: string;
    numFailedTasks?: number;
  }>;
  if (!jobs.length) return { status: 'no-jobs', wallMs: null, failedTasks: 0 };
  const starts = jobs.map((j) => Date.parse(j.submissionTime)).filter(Number.isFinite);
  const ends = jobs
    .filter((j) => j.completionTime)
    .map((j) => Date.parse(String(j.completionTime)))
    .filter(Number.isFinite);
  const wallMs = starts.length && ends.length ? Math.max(...ends) - Math.min(...starts) : null;
  const failedTasks = jobs.reduce((n, j) => n + (j.numFailedTasks || 0), 0);
  const status = jobs.some((j) => j.status === 'FAILED')
    ? 'FAILED'
    : jobs.every((j) => j.status === 'SUCCEEDED')
      ? 'SUCCEEDED'
      : 'RUNNING';
  return { status, wallMs, failedTasks };
}

async function runVariant(session: Record<string, unknown>, variant: string): Promise<void> {
  const store = getObjectStore();
  const owner = String(session.userId || 'bench');
  const sessionId = String(session.id);
  const projectPrefix = String(session.workspace_prefix || session.workspacePrefix || '');
  const benchKey = `${projectPrefix.replace(/\/?$/, '')}/bench/${variant}/src/main.py`;
  const py = APPROACH_PY.replace(
    'VARIANT = os.environ.get("VARIANT", "naive")',
    `VARIANT = "${variant}"`,
  );
  await store.putObject(benchKey, Buffer.from(py, 'utf8'));

  const job = await sparkJobs.startSparkJob({
    session: {
      id: sessionId,
      challengeId: CHALLENGE_ID,
      userId: owner,
      workspacePrefix: `workspaces/${CHALLENGE_ID}/${owner}/`,
      entrypoint: `bench/${variant}/src/main.py`,
    },
    mode: 'submit',
    businessDate: '2024-06-15',
    entrypoint: `bench/${variant}/src/main.py`,
    txnInputPath: 's3a://devlabs-data/datasets/payment-network/txns/150m-skew-key75/',
    rateInputPath: 's3a://devlabs-data/datasets/payment-network/dims/interchange_rate/',
    evalSolutionPath: 's3a://devlabs-data/challenges/l3-interchange-fee-settlement/expected/',
    gradeScript: 's3a://devlabs-data/challenges/l3-interchange-fee-settlement/grade/grade.py',
    outputFormat: 'csv',
    gradeKeys: ['country_code', 'entry_mode'],
  });

  const jobId = String(job.id || '');
  console.log(`\n=== ${variant} → job ${jobId} k8s=${job.k8sName} ===`);

  for (let i = 0; i < 120; i += 1) {
    await sleep(5000);
    const row = await sparkJobs.refreshJobFromPlatform(jobId);
    const status = String(row?.status || 'unknown');
    process.stdout.write(`  [${i * 5}s] ${status}\r`);
    if (status === 'succeeded' || status === 'failed') {
      console.log(`  [${i * 5}s] ${status} grade=${row?.gradeStatus || 'n/a'} pace=${row?.paceLabel || 'n/a'}`);
      const enriched = await sparkJobs.enrichJobDebug(jobId);
      const appId = String(enriched?.applicationId || '');
      if (appId) {
        const hm = await historyMetrics(appId);
        console.log(
          `  history=${appId} jobs=${hm.status} wall=${hm.wallMs != null ? Math.round(hm.wallMs / 1000) + 's' : '?'} failedTasks=${hm.failedTasks}`,
        );
        console.log(`  url=${process.env.SPARK_HISTORY_BASE || 'http://192.168.1.2:30080'}/history/${appId}/jobs/`);
      }
      if (row?.error) console.log(`  error=${row.error}`);
      return;
    }
  }
  console.log('  timed out waiting');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const variants = args.includes('--all')
    ? ALL_VARIANTS
    : args.length
      ? args
      : ['week_key', 'broadcast', 'repartition', 'aqe_skew', 'hot_split'];

  const sess = await pool.query(
    `SELECT id, challenge_id, user_id, workspace_prefix, entrypoint
       FROM sessions WHERE challenge_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [CHALLENGE_ID],
  );
  if (!sess.rows[0]) throw new Error(`no session for ${CHALLENGE_ID}`);
  console.log('session', sess.rows[0].id, 'variants', variants.join(', '));

  for (const variant of variants) {
    process.env.VARIANT = variant;
    await runVariant(sess.rows[0], variant);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
