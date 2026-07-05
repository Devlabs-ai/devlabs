/** Parsed pipeline log entry for rich UI rendering. */

export type PipelineLogEntry =
  | { kind: 'text'; text: string; level: 'info' | 'ok' | 'warn' | 'error' | 'phase' }
  | { kind: 'thinking'; label: string; step: number }
  | { kind: 'codeStep'; step: number; summary: string; tools: string; ms: number; cost: string; tokens: string }
  | { kind: 'codeDiff'; tool: string; path: string; body: string; summary?: boolean }
  | { kind: 'separator'; text: string };

const THINKING_PREFIX = '💭 ';
const CODE_STEP_PREFIX = '⚡ ';
const CODE_DIFF_HEADER = /^📋 CODE diff · ([^·]+) · (.+)$/;
const CODE_DIFF_CONT = /^📋  /;
const CODE_DIFF_SUMMARY = '📋 CODE repair summary';

export function formatCodeDiffLines(args: {
  tool?: string;
  path?: string;
  diff: string;
  summary?: boolean;
}): string[] {
  const tool = args.tool || 'code';
  const filePath = args.path || 'unknown';
  const header = args.summary
    ? CODE_DIFF_SUMMARY
    : `📋 CODE diff · ${tool} · ${filePath}`;
  return [header, ...args.diff.split('\n').map((line) => `📋  ${line}`)];
}

export function formatThinkingLog(label: string, step: number): string {
  return `${THINKING_PREFIX}${label} (step ${step + 1})`;
}

export function formatCodeStepLog(args: {
  step: number;
  tools: string;
  ms: number;
  cost: string;
  tokens: string;
}): string {
  const { step, tools, ms, cost, tokens } = args;
  return `${CODE_STEP_PREFIX}Step ${step + 1} · ${tools} · ${(ms / 1000).toFixed(1)}s · ${cost} · ${tokens}`;
}

/** Turn a persisted log line into a structured entry (or plain text). */
export function parseLogLine(line: string): PipelineLogEntry {
  if (line.startsWith(THINKING_PREFIX)) {
    const m = line.match(/^💭 (.+) \(step (\d+)\)$/);
    if (m) {
      return { kind: 'thinking', label: m[1], step: parseInt(m[2], 10) - 1 };
    }
  }
  if (line.startsWith(CODE_STEP_PREFIX)) {
    const body = line.slice(CODE_STEP_PREFIX.length);
    const parts = body.split(' · ');
    if (parts.length >= 5 && parts[0]?.startsWith('Step ')) {
      const stepMatch = parts[0].match(/^Step (\d+)$/);
      const timeStr = parts[parts.length - 3]?.replace(/s$/, '');
      const cost = parts[parts.length - 2];
      const tokens = parts[parts.length - 1];
      const tools = parts.slice(1, parts.length - 3).join(' · ');
      if (stepMatch && timeStr && cost && tokens) {
        return {
          kind: 'codeStep',
          step: parseInt(stepMatch[1], 10) - 1,
          tools,
          ms: parseFloat(timeStr) * 1000,
          cost,
          tokens,
          summary: line,
        };
      }
    }
    const plainStep = body.match(/^Step (\d+) · (.+)$/);
    if (plainStep) {
      return {
        kind: 'codeStep',
        step: parseInt(plainStep[1], 10) - 1,
        tools: plainStep[2],
        ms: 0,
        cost: '—',
        tokens: '—',
        summary: line,
      };
    }
  }
  if (line.startsWith('---')) {
    return { kind: 'separator', text: line };
  }
  let level: 'info' | 'ok' | 'warn' | 'error' | 'phase' = 'info';
  if (line.includes('✗') || line.includes(' FAIL') || /failed/i.test(line)) level = 'error';
  else if (line.includes('✓') || line.includes(' PASS') || /passed/i.test(line)) level = 'ok';
  else if (line.includes('⚠')) level = 'warn';
  else if (line.includes('►') || /^Iteration \d/.test(line) || /^Step: /.test(line)) level = 'phase';
  return { kind: 'text', text: line, level };
}

/** Parse log lines, grouping multi-line CODE repair diffs into single entries. */
export function parseLogLines(lines: string[]): PipelineLogEntry[] {
  const out: PipelineLogEntry[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line === CODE_DIFF_SUMMARY) {
      i += 1;
      const bodyLines: string[] = [];
      while (i < lines.length && CODE_DIFF_CONT.test(lines[i])) {
        bodyLines.push(lines[i].slice(4));
        i += 1;
      }
      out.push({
        kind: 'codeDiff',
        tool: 'repair_summary',
        path: '(all changes)',
        body: bodyLines.join('\n'),
        summary: true,
      });
      continue;
    }
    const headerMatch = line.match(CODE_DIFF_HEADER);
    if (headerMatch) {
      const tool = headerMatch[1].trim();
      const path = headerMatch[2].trim();
      i += 1;
      const bodyLines: string[] = [];
      while (i < lines.length && CODE_DIFF_CONT.test(lines[i])) {
        bodyLines.push(lines[i].slice(4));
        i += 1;
      }
      out.push({ kind: 'codeDiff', tool, path, body: bodyLines.join('\n') });
      continue;
    }
    out.push(parseLogLine(line));
    i += 1;
  }
  return out;
}
