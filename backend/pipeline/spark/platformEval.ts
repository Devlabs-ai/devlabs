'use strict';

/**
 * Run authoring solution on the Spark platform (same API as Play jobs).
 *
 * Uploads input/ + solution/ to a staging prefix, submits a Python job,
 * polls until terminal, downloads OUTPUT_PATH JSON.
 */

import * as fs from 'fs';
import * as path from 'path';

import type { SparkShapeContract, SparkWorkspaceLayout } from '../../types/sparkShape';

const { getObjectStore, normalizeKey } = require('../../workspace/objectStore');
const { uploadDirToPrefix, walkFiles } = require('./uploadDir');

const PLATFORM_API =
  process.env.SPARK_PLATFORM_API_URL || 'http://192.168.1.9:30088';

function s3a(key: string): string {
  const bucket = process.env.MINIO_BUCKET || process.env.S3_BUCKET || 'devlabs-data';
  return `s3a://${bucket}/${normalizeKey(key).replace(/^\/+/, '')}`;
}

async function platformFetch(
  apiPath: string,
  init?: RequestInit,
): Promise<{ status: number; json?: unknown; text?: string }> {
  const url = `${PLATFORM_API.replace(/\/$/, '')}${apiPath}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    return { status: res.status, json: await res.json() };
  }
  return { status: res.status, text: await res.text() };
}

function mapStatus(status: string | undefined): string {
  const s = (status || '').toUpperCase();
  if (s === 'SUCCEEDED' || s === 'COMPLETED') return 'succeeded';
  if (s === 'FAILED' || s === 'SUBMISSION_FAILED') return 'failed';
  if (s === 'RUNNING' || s === 'SUCCEEDING' || s === 'FAILING') return 'running';
  return 'queued';
}

function findEntrypoint(solutionDir: string, starterFileName: string): string | null {
  const preferred = path.join(solutionDir, starterFileName);
  if (fs.existsSync(preferred)) return starterFileName.replace(/^\/+/, '');
  if (fs.existsSync(path.join(solutionDir, 'src/main.py'))) return 'src/main.py';
  return null;
}

async function runSolutionOnPlatform({
  contract,
  layout,
  draftSessionId,
  onLog,
}: {
  contract: SparkShapeContract;
  layout: SparkWorkspaceLayout;
  draftSessionId: string;
  onLog?: (msg: string) => void;
}): Promise<{ ok: boolean; message: string; outputPath: string; stdout: string; stderr: string }> {
  const outputPath = path.join(layout.eval, 'job-output.json');
  fs.mkdirSync(layout.eval, { recursive: true });

  const entry = findEntrypoint(layout.solution, contract.platform.starterFileName);
  if (!entry) {
    return {
      ok: false,
      message: `solution entrypoint missing: ${contract.platform.starterFileName}`,
      outputPath,
      stdout: '',
      stderr: '',
    };
  }

  const stagePrefix = `challenges/${contract.meta.slug}/authoring/${draftSessionId}/`;
  const inputPrefix = `${stagePrefix}input/`;
  const appPrefix = `${stagePrefix}app/`;
  const resultKey = `${stagePrefix}results/solution.json`;

  const objectStore = getObjectStore();
  const existingInput = (await objectStore.listKeys(normalizeKey(inputPrefix).replace(/\/?$/, '/')))
    .filter((k: string) => !k.endsWith('/'));
  if (existingInput.length > 0) {
    onLog?.(`Input already in MinIO (${existingInput.length} object(s)) — skipping re-upload`);
  } else {
    onLog?.(`Uploading input → ${inputPrefix}`);
    await uploadDirToPrefix(layout.input, inputPrefix, { replace: true });
  }
  onLog?.(`Uploading solution → ${appPrefix}`);
  const appUp = await uploadDirToPrefix(layout.solution, appPrefix, { replace: true });
  if (appUp.deleted) onLog?.(`Replaced app/ (deleted ${appUp.deleted} stale object(s))`);

  const businessDate = contract.data.businessDate || '';
  // Pass the input ROOT so Spark hive partition discovery yields partition columns
  // (e.g. business_date). Reading .../business_date=YYYY-MM-DD/ alone omits that column
  // and breaks groupBy("business_date", ...).
  const inputPath = s3a(inputPrefix);
  const mainFile = s3a(`${appPrefix}${entry}`);
  const outputS3a = s3a(resultKey);

  const pyDeps = walkFiles(layout.solution)
    .map((f: { rel: string }) => f.rel)
    .filter((rel: string) => rel.endsWith('.py') && rel !== entry)
    .map((rel: string) => s3a(`${appPrefix}${rel}`));

  const limits = contract.platform.limits;
  const baseName = `auth-${contract.meta.slug}`
    .replace(/[^a-z0-9-]/gi, '-')
    .replace(/-+/g, '-')
    .slice(0, 36)
    .toLowerCase()
    .replace(/-$/, '');
  // Unique per attempt so retries do not 409 "job already exists"
  const k8sName = `${baseName}-${draftSessionId.slice(0, 8)}-${Date.now().toString(36)}`
    .slice(0, 63);

  const body = {
    name: k8sName,
    user: 'spark-authoring',
    type: 'Python',
    main_application_file: mainFile,
    python_version: '3',
    executor_instances: Math.min(4, Math.max(1, limits.executors || 2)),
    executor_cores: Math.min(2, Math.max(1, limits.executorCores || 1)),
    executor_memory: limits.executorMemory || '1g',
    driver_cores: 1,
    driver_memory: '1g',
    deps_py_files: pyDeps,
    env: {
      BUSINESS_DATE: businessDate,
      INPUT_PATH: inputPath,
      OUTPUT_PATH: outputS3a,
    },
  };

  onLog?.(`Submitting Spark job ${k8sName}`);
  const submit = await platformFetch('/api/jobs', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (submit.status >= 400) {
    return {
      ok: false,
      message: `platform submit failed (${submit.status}): ${JSON.stringify(submit.json || submit.text)}`,
      outputPath,
      stdout: '',
      stderr: String(submit.text || ''),
    };
  }

  const pollMs = Number(process.env.SPARK_EVAL_POLL_MS || 5000);
  const maxMs = Number(process.env.SPARK_EVAL_SOLUTION_TIMEOUT_MS || 20 * 60 * 1000);
  const started = Date.now();
  let lastStatus = 'queued';
  let logsText = '';

  while (Date.now() - started < maxMs) {
    await new Promise((r) => setTimeout(r, pollMs));
    const statusRes = await platformFetch(`/api/jobs/${encodeURIComponent(k8sName)}`);
    const job = (statusRes.json as { job?: { status?: string; error?: string } })?.job
      || (statusRes.json as { status?: string; error?: string });
    lastStatus = mapStatus((job as { status?: string })?.status);
    onLog?.(`Job status: ${lastStatus}`);

    const logsRes = await platformFetch(
      `/api/jobs/${encodeURIComponent(k8sName)}/logs?tail=200`,
    );
    if (logsRes.json && typeof logsRes.json === 'object') {
      const raw = (logsRes.json as { logs?: unknown }).logs;
      if (Array.isArray(raw)) logsText = raw.map(String).join('\n');
      else if (typeof raw === 'string') logsText = raw;
    } else if (typeof logsRes.text === 'string' && logsRes.text.trim()) {
      logsText = logsRes.text;
    }

    if (lastStatus === 'succeeded' || lastStatus === 'failed') break;
  }

  if (lastStatus !== 'succeeded') {
    const apiErr = await platformFetch(`/api/jobs/${encodeURIComponent(k8sName)}`);
    const jobMeta = (apiErr.json as { error?: string; status?: string }) || {};
    const errHint = typeof jobMeta.error === 'string' ? jobMeta.error : '';
    // Prefer Python traceback / AnalysisException lines for repair agents
    const interesting = logsText
      .split('\n')
      .filter((line) => /Traceback|Error|Exception|Caused by|TypeError|AnalysisException|FileNotFound|main\.py/i.test(line))
      .slice(-40)
      .join('\n');
    const tail = logsText.slice(-2000);
    const detail = [errHint, interesting || tail].filter(Boolean).join('\n---\n').slice(-3500)
      || `Spark job ${lastStatus} (no driver logs captured)`;
    return {
      ok: false,
      message: `Spark job ${lastStatus}: ${detail}`,
      outputPath,
      stdout: logsText,
      stderr: detail,
    };
  }

  const buf = await objectStore.getObject(normalizeKey(resultKey));
  if (!buf) {
    return {
      ok: false,
      message: `Job succeeded but missing output object ${resultKey}`,
      outputPath,
      stdout: logsText,
      stderr: '',
    };
  }
  fs.writeFileSync(outputPath, buf);
  return {
    ok: true,
    message: 'solution ok (platform)',
    outputPath,
    stdout: logsText,
    stderr: '',
  };
}

function platformEvalAvailable(): boolean {
  return Boolean(process.env.SPARK_PLATFORM_API_URL || process.env.SPARK_EVAL_USE_PLATFORM === '1');
}

module.exports = {
  runSolutionOnPlatform,
  platformEvalAvailable,
};
