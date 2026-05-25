export const BUCKETS = [
  { id: 'software-engineer', label: 'Software Engineer' },
  { id: 'data-engineer', label: 'Data Engineer' },
  { id: 'platform-engineer', label: 'Platform Engineer' },
  { id: 'devops', label: 'DevOps' },
];

const BUCKET_BY_ID = new Map(BUCKETS.map((b) => [b.id, b]));

export const UNBUCKETED = {
  id: '__unbucketed__',
  label: 'Unsorted',
};

export function bucketLabel(id) {
  return BUCKET_BY_ID.get(id)?.label || null;
}
