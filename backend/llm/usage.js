'use strict';

const { estimateCostUsd } = require('./cost');
const { modelIdFor } = require('./models');

function normalizeUsage(raw) {
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

function createUsageAccumulator() {
  const calls = [];

  return {
    add({ agent, modelId, usage, label }) {
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
    summary() {
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
    isEmpty() {
      return calls.length === 0;
    },
  };
}

module.exports = {
  normalizeUsage,
  createUsageAccumulator,
};
