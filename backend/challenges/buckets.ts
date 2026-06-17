'use strict';

import type { BucketId } from '../types/domain';

// Canonical role buckets that group challenges in the candidate library and
// drive the "Push to" choice in the review queue. Keep IDs URL-safe kebab-case
// and stable — challenge.json + the `bucket` column both store these IDs.
const BUCKETS: Array<{ id: BucketId; label: string }> = [
  { id: 'software-engineer', label: 'Software Engineer' },
  { id: 'data-engineer', label: 'Data Engineer' },
  { id: 'platform-engineer', label: 'Platform Engineer' },
  { id: 'devops', label: 'DevOps' },
];

const BUCKET_IDS = new Set<string>(BUCKETS.map((b) => b.id));

function normalizeBucket(value: unknown): BucketId | null {
  if (!value) return null;
  const id = String(value).trim().toLowerCase();
  return BUCKET_IDS.has(id) ? (id as BucketId) : null;
}

function bucketLabel(id: string): string | null {
  const match = BUCKETS.find((b) => b.id === id);
  return match ? match.label : null;
}

module.exports = { BUCKETS, BUCKET_IDS, normalizeBucket, bucketLabel };
