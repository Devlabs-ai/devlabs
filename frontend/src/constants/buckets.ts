import type { BucketId } from '../types/domain';

interface BucketEntry {
  id: BucketId;
  label: string;
}

export const BUCKETS: BucketEntry[] = [
  { id: 'software-engineer', label: 'Software Engineer' },
  { id: 'data-engineer', label: 'Data Engineer' },
  { id: 'platform-engineer', label: 'Platform Engineer' },
  { id: 'devops', label: 'DevOps' },
];

const BUCKET_BY_ID = new Map<BucketId, BucketEntry>(BUCKETS.map((b) => [b.id, b]));

export const UNBUCKETED = {
  id: '__unbucketed__',
  label: 'Unsorted',
};

export function bucketLabel(id: BucketId | string | null | undefined): string | null {
  if (!id) return null;
  return BUCKET_BY_ID.get(id as BucketId)?.label || null;
}
