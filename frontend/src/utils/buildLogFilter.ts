/** Slice flat build log lines for a single pipeline iteration. */
export function logsForAttempt(allLogs: string[], attempt: number): string[] {
  if (!attempt || !Array.isArray(allLogs) || !allLogs.length) {
    return allLogs || [];
  }

  const startNeedle = `Iteration ${attempt}/`;
  const nextNeedle = `Iteration ${attempt + 1}/`;

  let start = allLogs.findIndex((line) => line.includes(startNeedle));
  if (start < 0) {
    start = allLogs.findIndex((line) => line.includes(`Iteration ${attempt}`));
  }
  if (start < 0) return allLogs;

  let end = allLogs.length;
  for (let i = start + 1; i < allLogs.length; i++) {
    if (allLogs[i].includes(nextNeedle)) {
      end = i;
      break;
    }
  }

  return allLogs.slice(start, end);
}
