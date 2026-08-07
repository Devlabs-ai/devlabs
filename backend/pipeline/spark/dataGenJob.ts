'use strict';

/**
 * Authoring data-gen via platforms/devlabs-data K8s Job.
 *
 * Uploads gen/ → MinIO, runs run_authoring_generate.py in-cluster,
 * verifies DATA_S3_PREFIX, downloads input/ locally for platformEval/publish.
 */

import * as fs from 'fs';
import * as path from 'path';

import type { SparkDataBlock, SparkShapeContract, SparkWorkspaceLayout } from '../../types/sparkShape';

const { uploadDirToPrefix } = require('./uploadDir');
const { downloadPrefixToDir } = require('./downloadPrefix');
const {
  authoringGenPrefix,
  authoringInputPrefix,
  verifyPrefixHasObjects,
} = require('./authoringMinio');
const { createAndWaitJob, kubectlAvailable } = require('./k8sJobs');
const { getObjectStore, normalizeKey } = require('../../workspace/objectStore');

const DEFAULT_IMAGE = 'rithvikreddyalkanti/devlabs-data-tools:latest';
const DEFAULT_NAMESPACE = 'devlabs';
const DEFAULT_INCLUSTER_MINIO = 'http://minio.minio.svc.cluster.local:9000';

function resolveJobTemplatePath(): string {
  if (process.env.DEVLABS_DATA_JOB_TEMPLATE) {
    return process.env.DEVLABS_DATA_JOB_TEMPLATE;
  }
  // Sibling platforms/devlabs-data from monorepo checkout
  const candidates = [
    path.resolve(__dirname, '../../../../platforms/devlabs-data/k8s/job-generate-authoring.yaml'),
    path.resolve(__dirname, '../../../../../platforms/devlabs-data/k8s/job-generate-authoring.yaml'),
    path.resolve(process.cwd(), '../platforms/devlabs-data/k8s/job-generate-authoring.yaml'),
    path.resolve(process.cwd(), '../../platforms/devlabs-data/k8s/job-generate-authoring.yaml'),
    path.resolve(process.cwd(), 'platforms/devlabs-data/k8s/job-generate-authoring.yaml'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

function scaleToJobEnv(data: SparkDataBlock): {
  NUM_STORES: string;
  ROWS_PER_STORE: string;
  MALFORMED_RATE: string;
} {
  const stores = Math.max(1, Number(data.scale?.stores) || 5);
  const approx = Number(data.scale?.approxRows) || stores * 200;
  const rowsPerStore = Math.max(1, Math.ceil(approx / stores));
  const rate = data.malformed?.enabled === false
    ? 0
    : Number(data.malformed?.rate ?? 0.01);
  return {
    NUM_STORES: String(stores),
    ROWS_PER_STORE: String(rowsPerStore),
    MALFORMED_RATE: String(rate),
  };
}

function renderJobYaml(opts: {
  jobName: string;
  namespace: string;
  image: string;
  businessDate: string;
  scale: ReturnType<typeof scaleToJobEnv>;
  genPrefix: string;
  dataPrefix: string;
  minioEndpoint: string;
  minioBucket: string;
}): string {
  const templatePath = resolveJobTemplatePath();
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Job template missing: ${templatePath}`);
  }
  let yaml = fs.readFileSync(templatePath, 'utf8');
  const reps: Record<string, string> = {
    JOB_NAME_PLACEHOLDER: opts.jobName,
    NAMESPACE_PLACEHOLDER: opts.namespace,
    IMAGE_PLACEHOLDER: opts.image,
    BUSINESS_DATE_PLACEHOLDER: opts.businessDate || '2026-01-15',
    NUM_STORES_PLACEHOLDER: opts.scale.NUM_STORES,
    ROWS_PER_STORE_PLACEHOLDER: opts.scale.ROWS_PER_STORE,
    MALFORMED_RATE_PLACEHOLDER: opts.scale.MALFORMED_RATE,
    GEN_S3_PREFIX_PLACEHOLDER: opts.genPrefix.replace(/\/$/, ''),
    DATA_S3_PREFIX_PLACEHOLDER: opts.dataPrefix.replace(/\/$/, ''),
    MINIO_ENDPOINT_PLACEHOLDER: opts.minioEndpoint,
    MINIO_BUCKET_PLACEHOLDER: opts.minioBucket,
  };
  for (const [from, to] of Object.entries(reps)) {
    yaml = yaml.split(from).join(to);
  }
  return yaml;
}

function dataGenMode(): 'k8s' | 'local' {
  const mode = (process.env.SPARK_EVAL_DATA_GEN_MODE || 'k8s').toLowerCase();
  return mode === 'local' ? 'local' : 'k8s';
}

function interestingTail(text: string, maxLines = 40): string {
  if (!text) return '';
  const lines = text.split('\n');
  const hit = lines.filter((line) =>
    /Traceback|Error|Exception|TypeError|ArrowInvalid|generate\.py|FAILED|exited/i.test(line),
  );
  return (hit.length ? hit : lines).slice(-maxLines).join('\n').trim();
}

function k8sDataGenAvailable(): boolean {
  return dataGenMode() === 'k8s' && kubectlAvailable();
}

export interface AuthoringDataGenResult {
  ok: boolean;
  message: string;
  mode: 'k8s' | 'local';
  s3Prefix: string;
  jobName: string | null;
  stdout: string;
  stderr: string;
}

async function runAuthoringDataGenJob({
  contract,
  layout,
  draftSessionId,
  onLog,
}: {
  contract: SparkShapeContract;
  layout: SparkWorkspaceLayout;
  draftSessionId: string;
  onLog?: (msg: string) => void;
}): Promise<AuthoringDataGenResult> {
  const slug = contract.meta.slug;
  const genPrefix = authoringGenPrefix(slug, draftSessionId);
  const inputPrefix = authoringInputPrefix(slug, draftSessionId);
  const empty = {
    s3Prefix: inputPrefix,
    jobName: null as string | null,
    stdout: '',
    stderr: '',
  };

  onLog?.(`Uploading gen/ → ${genPrefix}`);
  const uploaded = await uploadDirToPrefix(layout.gen, genPrefix, { replace: true });
  if (uploaded.count === 0) {
    return {
      ...empty,
      ok: false,
      mode: 'k8s',
      message: 'gen/ is empty — nothing to run in cluster',
    };
  }
  onLog?.(
    `Uploaded ${uploaded.count} gen file(s)`
      + (uploaded.deleted ? ` (replaced; deleted ${uploaded.deleted} stale object(s))` : ''),
  );

  // Clear previous input so a retry cannot mix with old Parquet / nested leftovers
  try {
    const store = getObjectStore();
    const purged = await store.deletePrefix(normalizeKey(inputPrefix).replace(/\/?$/, '/'));
    if (purged > 0) onLog?.(`Purged ${purged} stale object(s) under ${inputPrefix}`);
  } catch (e) {
    onLog?.(`Input purge warning: ${(e as Error).message}`);
  }

  const namespace = process.env.DEVLABS_NAMESPACE || DEFAULT_NAMESPACE;
  const image = process.env.DEVLABS_DATA_IMAGE || DEFAULT_IMAGE;
  const minioEndpoint =
    process.env.MINIO_INCLUSTER_ENDPOINT || DEFAULT_INCLUSTER_MINIO;
  const minioBucket = process.env.MINIO_BUCKET || process.env.S3_BUCKET || 'devlabs-data';
  const timeoutMs = Number(process.env.DEVLABS_DATA_JOB_TIMEOUT_MS || 15 * 60 * 1000);
  const jobName = `auth-gen-${draftSessionId.slice(0, 8)}-${Date.now()}`.toLowerCase();
  const scale = scaleToJobEnv(contract.data);

  let yaml: string;
  try {
    yaml = renderJobYaml({
      jobName,
      namespace,
      image,
      businessDate: contract.data.businessDate || '',
      scale,
      genPrefix,
      dataPrefix: inputPrefix,
      minioEndpoint,
      minioBucket,
    });
  } catch (e) {
    return {
      ...empty,
      ok: false,
      mode: 'k8s',
      message: (e as Error).message,
    };
  }

  onLog?.(
    `Submitting data-gen Job ${jobName} (${scale.NUM_STORES}×${scale.ROWS_PER_STORE}, image=${image})`,
  );
  const job = await createAndWaitJob({
    name: jobName,
    namespace,
    yaml,
    timeoutMs,
  });

  if (!job.ok) {
    // job.logs = container stdout/stderr (traceback). Prefer that for repair agents.
    const logs = (job.logs || '').trim();
    return {
      ok: false,
      mode: 'k8s',
      message: logs
        ? `data-gen Job failed: ${interestingTail(logs) || job.message.slice(0, 400)}`
        : job.message,
      s3Prefix: inputPrefix,
      jobName,
      stdout: logs,
      stderr: logs || job.message,
    };
  }

  const verified = await verifyPrefixHasObjects(inputPrefix, 1);
  if (!verified.ok) {
    return {
      ok: false,
      mode: 'k8s',
      message: `Job succeeded but no objects under ${inputPrefix}`,
      s3Prefix: inputPrefix,
      jobName,
      stdout: job.logs,
      stderr: '',
    };
  }

  onLog?.(`Data in MinIO (${verified.count} object(s)); syncing → layout.input`);
  fs.mkdirSync(layout.input, { recursive: true });
  const downloaded = await downloadPrefixToDir(inputPrefix, layout.input);

  return {
    ok: true,
    mode: 'k8s',
    message: `data-gen Job ok — ${downloaded.count} file(s) under ${inputPrefix}`,
    s3Prefix: inputPrefix,
    jobName,
    stdout: job.logs,
    stderr: '',
  };
}

module.exports = {
  runAuthoringDataGenJob,
  k8sDataGenAvailable,
  dataGenMode,
  scaleToJobEnv,
  resolveJobTemplatePath,
};
