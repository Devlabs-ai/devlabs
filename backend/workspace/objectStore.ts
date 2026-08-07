'use strict';

/**
 * Object storage for spark workspaces — MinIO/S3 only.
 * Requires MINIO_ENDPOINT (or S3_ENDPOINT).
 */

import type { Readable } from 'stream';

export interface ObjectPutResult {
  etag: string | null;
  size: number;
}

export interface ObjectStore {
  putObject(key: string, body: string | Buffer, contentType?: string): Promise<ObjectPutResult>;
  getObject(key: string): Promise<Buffer | null>;
  deleteObject(key: string): Promise<void>;
  copyObject(fromKey: string, toKey: string): Promise<void>;
  listKeys(prefix: string): Promise<string[]>;
  deletePrefix(prefix: string): Promise<number>;
  purgeDeleteMarkers(prefix: string): Promise<number>;
  mode: 's3';
  endpoint: string;
  bucket: string;
}

function normalizeKey(key: string): string {
  return key.replace(/^\/+/, '').replace(/\\/g, '/');
}

function createS3Store(endpoint: string): ObjectStore {
  const {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
    CopyObjectCommand,
    ListObjectsV2Command,
  } = require('@aws-sdk/client-s3');

  const region = process.env.MINIO_REGION || process.env.S3_REGION || 'us-east-1';
  const bucket = process.env.MINIO_BUCKET || process.env.S3_BUCKET || 'devlabs-data';
  const forcePathStyle = (process.env.MINIO_FORCE_PATH_STYLE || 'true') !== 'false';

  const client = new S3Client({
    region,
    endpoint,
    forcePathStyle,
    credentials: {
      accessKeyId: process.env.MINIO_ACCESS_KEY || process.env.AWS_ACCESS_KEY_ID || 'devlabs',
      secretAccessKey:
        process.env.MINIO_SECRET_KEY || process.env.AWS_SECRET_ACCESS_KEY || 'devlabs-minio-change-me',
    },
  });

  async function streamToBuffer(body: Readable | ReadableStream | Blob | undefined): Promise<Buffer> {
    if (!body) return Buffer.alloc(0);
    if (Buffer.isBuffer(body)) return body;
    if (typeof (body as Readable).pipe === 'function') {
      const chunks: Buffer[] = [];
      for await (const chunk of body as AsyncIterable<Buffer | string>) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    }
    const reader = (body as ReadableStream).getReader?.();
    if (reader) {
      const chunks: Uint8Array[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }
      return Buffer.concat(chunks.map((u) => Buffer.from(u)));
    }
    return Buffer.from(await new Response(body as Blob).arrayBuffer());
  }

  async function listKeys(prefix: string): Promise<string[]> {
    const n = normalizeKey(prefix);
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const out = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: n.endsWith('/') || n === '' ? n : `${n}/`,
          ContinuationToken: token,
        }),
      );
      for (const obj of out.Contents || []) {
        if (obj.Key) keys.push(obj.Key);
      }
      token = out.IsTruncated ? out.NextContinuationToken : undefined;
    } while (token);
    return keys;
  }

  return {
    mode: 's3',
    endpoint,
    bucket,
    async putObject(key, body, contentType = 'application/octet-stream') {
      const n = normalizeKey(key);
      const buf = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
      const out = await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: n,
          Body: buf,
          ContentType: contentType,
        }),
      );
      return { etag: out.ETag || null, size: buf.length };
    },
    async getObject(key) {
      const n = normalizeKey(key);
      try {
        const out = await client.send(
          new GetObjectCommand({ Bucket: bucket, Key: n }),
        );
        return streamToBuffer(out.Body as Readable);
      } catch (e: unknown) {
        const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
        if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) return null;
        throw e;
      }
    },
    async deleteObject(key) {
      const n = normalizeKey(key);
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: n }));
    },
    async copyObject(fromKey, toKey) {
      const from = normalizeKey(fromKey);
      const to = normalizeKey(toKey);
      if (from === to) return;
      const copySource = `${bucket}/${from.split('/').map(encodeURIComponent).join('/')}`;
      await client.send(
        new CopyObjectCommand({
          Bucket: bucket,
          CopySource: copySource,
          Key: to,
        }),
      );
    },
    listKeys,
    async deletePrefix(prefix) {
      const keys = await listKeys(prefix);
      let deleted = 0;
      for (const key of keys) {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
        deleted += 1;
      }
      return deleted;
    },
    async purgeDeleteMarkers(prefix) {
      const { ListObjectVersionsCommand } = require('@aws-sdk/client-s3');
      let keyMarker: string | undefined;
      let versionIdMarker: string | undefined;
      let removed = 0;
      for (;;) {
        const out = await client.send(
          new ListObjectVersionsCommand({
            Bucket: bucket,
            Prefix: normalizeKey(prefix),
            KeyMarker: keyMarker,
            VersionIdMarker: versionIdMarker,
          }),
        );
        for (const m of out.DeleteMarkers || []) {
          await client.send(
            new DeleteObjectCommand({
              Bucket: bucket,
              Key: m.Key!,
              VersionId: m.VersionId,
            }),
          );
          removed += 1;
        }
        if (!out.IsTruncated) break;
        keyMarker = out.NextKeyMarker;
        versionIdMarker = out.NextVersionIdMarker;
      }
      return removed;
    },
  };
}

let cached: ObjectStore | null = null;

function getObjectStore(): ObjectStore {
  if (cached) return cached;
  const endpoint = process.env.MINIO_ENDPOINT || process.env.S3_ENDPOINT;
  if (!endpoint) {
    throw Object.assign(
      new Error('MINIO_ENDPOINT is required for spark workspaces (no local filesystem fallback)'),
      { status: 503 },
    );
  }
  cached = createS3Store(endpoint);
  console.log(`[objectStore] using S3/MinIO at ${endpoint}`);
  return cached;
}

module.exports = {
  getObjectStore,
  normalizeKey,
};
