'use strict';

const { estimateCostUsd } = require('./cost');
const { modelIdFor } = require('./models');

interface RawUsage {
  inputTokens?: number;
  outputTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

interface NormalizedUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

function normalizeUsage(raw: RawUsage | null | undefined): NormalizedUsage {
  if (!raw) {
    return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  }
  const input = raw.inputTokens ?? raw.promptTokens ?? 0;
  const output = raw.outputTokens ?? raw.completionTokens ?? 0;
  const total = raw.totalTokens ?? (input + output);
  return {
    inputTokens: Number(input) || 0,
    outputTokens: Number(output) || 0,
    totalTokens: Number(total) || 0,
  };
}

interface AddCallOpts {
  agent?: string | null;
  modelId?: string | null;
  usage?: RawUsage | null;
  label?: string | null;
}

interface UsageCall {
  agent: string | null;
  label: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
}

interface UsageSummary {
  currency: string;
  totalUsd: number;
  inputTokens: number;
  outputTokens: number;
  calls: UsageCall[];
}

function createUsageAccumulator(): {
  add: (opts: AddCallOpts) => void;
  summary: () => UsageSummary;
  isEmpty: () => boolean;
} {
  const calls: UsageCall[] = [];

  return {
    add({ agent, modelId, usage, label }: AddCallOpts): void {
      const resolvedModel = modelId || modelIdFor(agent);
      const normalized = normalizeUsage(usage);
      if (!normalized.inputTokens && !normalized.outputTokens) return;
      const costUsd = estimateCostUsd(resolvedModel, normalized);
      calls.push({
        agent: agent || null,
        label: label || agent || 'llm',
        modelId: resolvedModel,
        inputTokens: normalized.inputTokens,
        outputTokens: normalized.outputTokens,
        totalTokens: normalized.totalTokens,
        costUsd,
      });
    },
    summary(): UsageSummary {
      const inputTokens = calls.reduce((s, c) => s + c.inputTokens, 0);
      const outputTokens = calls.reduce((s, c) => s + c.outputTokens, 0);
      const totalUsd = calls.reduce((s, c) => s + c.costUsd, 0);
      return {
        currency: 'USD',
        totalUsd: Math.round(totalUsd * 1e6) / 1e6,
        inputTokens,
        outputTokens,
        calls,
      };
    },
    isEmpty(): boolean {
      return calls.length === 0;
    },
  };
}

module.exports = {
  normalizeUsage,
  createUsageAccumulator,
};
