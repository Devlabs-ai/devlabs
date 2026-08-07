/** Parsed pipeline log entry for rich UI rendering. */

export type PipelineLogEntry =
  | { kind: 'text'; text: string; level: 'info' | 'ok' | 'warn' | 'error' | 'phase'; agent?: string }
  | { kind: 'thinking'; label: string; step: number; agent?: string }
  | {
    kind: 'codeStep';
    step: number;
    summary: string;
    tools: string;
    ms: number;
    cost: string;
    tokens: string;
    agent?: string;
  }
  | { kind: 'codeDiff'; tool: string; path: string; body: string; summary?: boolean; agent?: string }
  | { kind: 'separator'; text: string };

const THINKING_PREFIX = '💭 ';
const CODE_STEP_PREFIX = '⚡ ';
const CODE_DIFF_HEADER = /^📋 CODE diff · ([^·]+) · (.+)$/;
const CODE_DIFF_CONT = /^📋  /;
const CODE_DIFF_SUMMARY = '📋 CODE repair summary';
const AGENT_PREFIX = /^\[([^\]]+)\]\s*/;

/** Strip and return leading [Agent Name] if present. */
export function splitAgentPrefix(line: string): { agent?: string; rest: string } {
  const m = line.match(AGENT_PREFIX);
  if (!m) return { rest: line };
  return { agent: m[1].trim(), rest: line.slice(m[0].length) };
}

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

/** Map SSE / event tag → display name (mirrors backend agentLogLabel). */
const AGENT_TAG_NAMES: Record<string, string> = {
  spark_data: 'Data Agent',
  spark_code: 'Code Agent',
  spark_validation: 'Validation Agent',
  spark_eval: 'Eval Agent',
  spark_eval_repair: 'Eval Repair',
  spark_pipeline: 'Pipeline',
  spark_design: 'Design Agent',
  design: 'Design Agent',
  schema: 'Schema Agent',
  code: 'Code Agent',
  validate: 'Validation Agent',
  validation: 'Validation Agent',
  spin: 'Spin',
  build: 'Build',
  lessons: 'Lessons',
};

export function agentNameFromTag(tag: unknown): string | null {
  if (typeof tag !== 'string' || !tag.trim()) return null;
  return AGENT_TAG_NAMES[tag.trim()] || null;
}

/** Turn a persisted log line into a structured entry (or plain text). */
export function parseLogLine(line: string): PipelineLogEntry {
  const { agent, rest } = splitAgentPrefix(line);

  if (rest.startsWith(THINKING_PREFIX)) {
    const m = rest.match(/^💭 (.+) \(step (\d+)\)$/);
    if (m) {
      return { kind: 'thinking', label: m[1], step: parseInt(m[2], 10) - 1, agent };
    }
  }
  if (rest.startsWith(CODE_STEP_PREFIX)) {
    const body = rest.slice(CODE_STEP_PREFIX.length);
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
          summary: rest,
          agent,
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
        summary: rest,
        agent,
      };
    }
  }
  if (rest.startsWith('---')) {
    return { kind: 'separator', text: rest };
  }
  let level: 'info' | 'ok' | 'warn' | 'error' | 'phase' = 'info';
  if (rest.includes('✗') || rest.includes(' FAIL') || /failed/i.test(rest)) level = 'error';
  else if (rest.includes('✓') || rest.includes(' PASS') || /passed/i.test(rest)) level = 'ok';
  else if (rest.includes('⚠')) level = 'warn';
  else if (rest.includes('►') || /^Iteration \d/.test(rest) || /^Step: /.test(rest)) level = 'phase';
  return { kind: 'text', text: rest, level, agent };
}

/** Parse log lines, grouping multi-line CODE repair diffs into single entries. */
export function parseLogLines(lines: string[]): PipelineLogEntry[] {
  const out: PipelineLogEntry[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const { agent, rest } = splitAgentPrefix(line);
    if (rest === CODE_DIFF_SUMMARY) {
      i += 1;
      const bodyLines: string[] = [];
      while (i < lines.length && CODE_DIFF_CONT.test(splitAgentPrefix(lines[i]).rest)) {
        bodyLines.push(splitAgentPrefix(lines[i]).rest.slice(4));
        i += 1;
      }
      out.push({
        kind: 'codeDiff',
        tool: 'repair_summary',
        path: '(all changes)',
        body: bodyLines.join('\n'),
        summary: true,
        agent,
      });
      continue;
    }
    const headerMatch = rest.match(CODE_DIFF_HEADER);
    if (headerMatch) {
      const tool = headerMatch[1].trim();
      const path = headerMatch[2].trim();
      i += 1;
      const bodyLines: string[] = [];
      while (i < lines.length && CODE_DIFF_CONT.test(splitAgentPrefix(lines[i]).rest)) {
        bodyLines.push(splitAgentPrefix(lines[i]).rest.slice(4));
        i += 1;
      }
      out.push({ kind: 'codeDiff', tool, path, body: bodyLines.join('\n'), agent });
      continue;
    }
    out.push(parseLogLine(line));
    i += 1;
  }
  return out;
}
