export const MONTHLY_PAPER_PATH = '/monthly-paper';

/** "October 2026" — the month a paper was picked in, or the current month for the default pick. */
export function monthLabel(at: number | null): string {
  return new Date(at ?? Date.now()).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}
