export const LEADERBOARD_PATH = '/leaderboard';
export const LEARNERS_PATH = '/learners';

export function learnerPath(id: string): string {
  return `${LEARNERS_PATH}/${encodeURIComponent(id)}`;
}
