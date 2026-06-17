import type { ReviewRecord } from '../types/domain';
import { bucketLabel } from '../constants/buckets';

export function bucketFromReview(r: ReviewRecord | null | undefined): string | null {
  const bc = r?.builtChallenge as { bucket?: string; meta?: { bucket?: string } } | undefined;
  return bc?.bucket || (bc?.meta as { bucket?: string } | undefined)?.bucket || null;
}

const CATEGORY_BUCKET: Record<string, string> = {
  kafka: 'data-engineer',
  spark: 'data-engineer',
  airflow: 'data-engineer',
  postgres: 'platform-engineer',
  redis: 'platform-engineer',
  python: 'software-engineer',
  networking: 'devops',
  general: 'software-engineer',
};

export function resolvePushBucket(r: ReviewRecord | null | undefined): string {
  const preset = bucketFromReview(r);
  if (preset) return preset;
  const bc = r?.builtChallenge as { category?: string; meta?: { category?: string } } | undefined;
  const cat = (bc?.category || (bc?.meta as { category?: string } | undefined)?.category || '')
    .toLowerCase()
    .trim();
  return CATEGORY_BUCKET[cat] || 'software-engineer';
}

export { bucketLabel };

const SIGNOFF_KEY = 'devlabs-review-signoff';

interface ReviewSignoff {
  touched: boolean;
  validated: boolean;
}

export function getReviewSignoff(sessionId: string): ReviewSignoff {
  try {
    const all = JSON.parse(sessionStorage.getItem(SIGNOFF_KEY) || '{}') as Record<string, ReviewSignoff>;
    return all[sessionId] || { touched: false, validated: false };
  } catch (_e) {
    return { touched: false, validated: false };
  }
}

export function setReviewSignoff(sessionId: string, patch: Partial<ReviewSignoff>): void {
  try {
    const all = JSON.parse(sessionStorage.getItem(SIGNOFF_KEY) || '{}') as Record<string, ReviewSignoff>;
    all[sessionId] = { ...getReviewSignoff(sessionId), ...patch };
    sessionStorage.setItem(SIGNOFF_KEY, JSON.stringify(all));
  } catch (_e) { /* ignore */ }
}

export function clearReviewSignoff(sessionId: string): void {
  try {
    const all = JSON.parse(sessionStorage.getItem(SIGNOFF_KEY) || '{}') as Record<string, ReviewSignoff>;
    delete all[sessionId];
    sessionStorage.setItem(SIGNOFF_KEY, JSON.stringify(all));
  } catch (_e) { /* ignore */ }
}
