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
