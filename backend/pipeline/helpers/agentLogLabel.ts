'use strict';

/**
 * Human-readable agent labels for pipeline logs.
 * Prefer tagging events with `tag` (or `agent`); messages get prefixed `[Name]`.
 */

const AGENT_DISPLAY_NAMES: Record<string, string> = {
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
  embedding: 'Embedding',
};

function agentDisplayName(tag: unknown): string | null {
  if (typeof tag !== 'string' || !tag.trim()) return null;
  const key = tag.trim();
  if (AGENT_DISPLAY_NAMES[key]) return AGENT_DISPLAY_NAMES[key];
  // spark_foo_bar → Spark Foo Bar; foo_bar → Foo Bar
  return key
    .split(/[_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Prefix message with [Agent Name] unless already labeled. */
function withAgentLabel(tag: unknown, message: string): string {
  const name = agentDisplayName(tag);
  if (!name || !message) return message;
  const bracket = `[${name}]`;
  if (message.startsWith(bracket) || message.startsWith(`${bracket} `)) return message;
  // Already has a different [Label] — leave alone
  if (/^\[[^\]]+\]\s/.test(message)) return message;
  return `${bracket} ${message}`;
}

module.exports = {
  AGENT_DISPLAY_NAMES,
  agentDisplayName,
  withAgentLabel,
};
