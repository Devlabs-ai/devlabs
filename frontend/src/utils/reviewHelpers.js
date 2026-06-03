import { bucketLabel } from '../constants/buckets.js';

export function bucketFromReview(r) {
  return r?.builtChallenge?.bucket
    || r?.builtChallenge?.meta?.bucket
    || null;
}

const CATEGORY_BUCKET = {
  kafka: 'data-engineer',
  spark: 'data-engineer',
  airflow: 'data-engineer',
  postgres: 'platform-engineer',
  redis: 'platform-engineer',
  python: 'software-engineer',
  networking: 'devops',
  general: 'software-engineer',
};

export function resolvePushBucket(r) {
  const preset = bucketFromReview(r);
  if (preset) return preset;
  const cat = (r?.builtChallenge?.category || r?.builtChallenge?.meta?.category || '')
    .toLowerCase()
    .trim();
  return CATEGORY_BUCKET[cat] || 'software-engineer';
}

export { bucketLabel };

const SIGNOFF_KEY = 'devlabs-review-signoff';

export function getReviewSignoff(sessionId) {
  try {
    const all = JSON.parse(sessionStorage.getItem(SIGNOFF_KEY) || '{}');
    return all[sessionId] || { touched: false, validated: false };
  } catch (_e) {
    return { touched: false, validated: false };
  }
}

export function setReviewSignoff(sessionId, patch) {
  try {
    const all = JSON.parse(sessionStorage.getItem(SIGNOFF_KEY) || '{}');
    all[sessionId] = { ...getReviewSignoff(sessionId), ...patch };
    sessionStorage.setItem(SIGNOFF_KEY, JSON.stringify(all));
  } catch (_e) { /* ignore */ }
}

export function clearReviewSignoff(sessionId) {
  try {
    const all = JSON.parse(sessionStorage.getItem(SIGNOFF_KEY) || '{}');
    delete all[sessionId];
    sessionStorage.setItem(SIGNOFF_KEY, JSON.stringify(all));
  } catch (_e) { /* ignore */ }
}
