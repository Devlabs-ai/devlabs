'use strict';

const { v4: uuidv4 } = require('uuid');
const pool = require('../db/pool');
const k8s = require('./k8sCluster');
const loader = require('../challenges/loader');

export type K8sGradeResult = {
  passed: boolean;
  message: string;
  stdout: string;
  stderr: string;
};

export type K8sSubmissionRecord = {
  id: string;
  sessionId: string;
  challengeId: string | null;
  name: string;
  status: string;
  gradeStatus: string | null;
  passed: boolean;
  message: string;
  stdout: string;
  stderr: string;
  submittedAt: number | null;
  gradedAt: number | null;
};

async function gradeK8sSession(
  ns: string,
  challengeId: string,
): Promise<K8sGradeResult> {
  const c = loader.getChallenge(challengeId) as {
    k8sPlatform?: { grade?: { script?: string; timeoutSeconds?: number } };
  } | null;
  const script = c?.k8sPlatform?.grade?.script || 'grade.sh';
  const timeoutMs = Math.max(
    10_000,
    (c?.k8sPlatform?.grade?.timeoutSeconds || 60) * 1000,
  );

  const result = await k8s.runChallengeScript(ns, challengeId, script, { timeoutMs });
  const stdout = (result.stdout || '').trim();
  const stderr = (result.stderr || '').trim();
  const passed = result.code === 0;
  const message = passed
    ? stdout.split('\n').filter(Boolean).pop() || 'PASS'
    : stderr.split('\n').filter(Boolean).pop()
      || stdout.split('\n').filter(Boolean).pop()
      || `grade exited ${result.code}`;

  return { passed, message, stdout, stderr };
}

async function recordK8sSubmission(
  session: { id: string; challengeId?: string | null; userId?: string | null },
  grade: K8sGradeResult,
): Promise<K8sSubmissionRecord> {
  const jobId = uuidv4();
  const now = Date.now();
  const gradePayload = {
    passed: grade.passed,
    kind: 'k8s',
    summary: grade.message,
    stdout: grade.stdout,
    stderr: grade.stderr,
    gradedAt: now,
  };
  const name = `k8s-${jobId.slice(0, 8)}`;
  await pool.query(
    `INSERT INTO submissions
       (id, session_id, challenge_id, user_id, mode, k8s_name, status,
        entrypoint, input_path, output_path, report_path, results_path, app_prefix,
        manifest_key, platform_job, error, logs, grade_status, grade_result, graded_at,
        submitted_at, updated_at, finished_at)
     VALUES ($1,$2,$3,$4,'submit',$5,'succeeded',$6,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,$7,$8,$9,$10,$10,$10,$10)`,
    [
      jobId,
      session.id,
      session.challengeId || null,
      session.userId || null,
      name,
      'kubernetes',
      JSON.stringify([grade.message]),
      grade.passed ? 'passed' : 'failed',
      JSON.stringify(gradePayload),
      now,
    ],
  );
  return {
    id: jobId,
    sessionId: session.id,
    challengeId: session.challengeId || null,
    name,
    status: 'succeeded',
    gradeStatus: grade.passed ? 'passed' : 'failed',
    passed: grade.passed,
    message: grade.message,
    stdout: grade.stdout,
    stderr: grade.stderr,
    submittedAt: now,
    gradedAt: now,
  };
}

function publicK8sSubmission(row: Record<string, unknown>): K8sSubmissionRecord {
  let grade: Record<string, unknown> | null = null;
  const raw = row.grade_result;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    grade = raw as Record<string, unknown>;
  } else if (typeof raw === 'string') {
    try {
      grade = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      grade = null;
    }
  }
  const passed = row.grade_status === 'passed' || grade?.passed === true;
  const message =
    (typeof grade?.summary === 'string' && grade.summary)
    || (typeof grade?.message === 'string' && grade.message)
    || (passed ? 'PASS' : 'FAIL');
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    challengeId: row.challenge_id != null ? String(row.challenge_id) : null,
    name: String(row.k8s_name || row.id),
    status: String(row.status || 'succeeded'),
    gradeStatus: row.grade_status != null ? String(row.grade_status) : null,
    passed,
    message,
    stdout: typeof grade?.stdout === 'string' ? grade.stdout : '',
    stderr: typeof grade?.stderr === 'string' ? grade.stderr : '',
    submittedAt: row.submitted_at != null ? Number(row.submitted_at) : null,
    gradedAt: row.graded_at != null ? Number(row.graded_at) : null,
  };
}

async function listK8sSubmissionsForSession(sessionId: string): Promise<K8sSubmissionRecord[]> {
  const { rows } = await pool.query(
    `SELECT * FROM submissions
       WHERE session_id = $1 AND mode = 'submit' AND entrypoint = 'kubernetes'
       ORDER BY submitted_at DESC LIMIT 50`,
    [sessionId],
  );
  return (rows as Record<string, unknown>[]).map(publicK8sSubmission);
}

module.exports = {
  gradeK8sSession,
  recordK8sSubmission,
  listK8sSubmissionsForSession,
};
