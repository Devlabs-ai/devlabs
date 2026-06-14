'use strict';

// Estimated USD per 1M tokens (input / output). Override via LLM_PRICING_JSON env
// as { "gpt-4o": { "input": 2.5, "output": 10 }, ... }.

interface ModelRates {
  input: number;
  output: number;
}

interface PricingTable {
  [model: string]: ModelRates;
}

interface UsageLike {
  inputTokens?: number;
  outputTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
}

const DEFAULT_PRICING: PricingTable = {
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4.5': { input: 75, output: 150 },
  'gpt-4.1': { input: 2, output: 8 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'o3-mini': { input: 1.1, output: 4.4 },
  'claude-sonnet-4-5-20250929': { input: 3, output: 15 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-3-5-sonnet-20241022': { input: 3, output: 15 },
  'text-embedding-3-small': { input: 0.02, output: 0 },
};

function loadPricingTable(): PricingTable {
  const raw = process.env.LLM_PRICING_JSON;
  if (!raw) return { ...DEFAULT_PRICING };
  try {
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_PRICING, ...parsed };
  } catch (e: unknown) {
    console.warn(`[llm/cost] invalid LLM_PRICING_JSON: ${(e as Error).message}`);
    return { ...DEFAULT_PRICING };
  }
}

const PRICING = loadPricingTable();

function modelNameFromId(modelId: unknown): string {
  const id = String(modelId || '');
  const colon = id.indexOf(':');
  return colon >= 0 ? id.slice(colon + 1) : id;
}

function ratesForModel(modelId: string): ModelRates {
  const name = modelNameFromId(modelId);
  if (PRICING[name]) return PRICING[name];
  if (name.includes('mini') || name.includes('4o-mini')) return PRICING['gpt-4o-mini'];
  if (name.includes('embedding')) return PRICING['text-embedding-3-small'];
  if (name.includes('claude')) return PRICING['claude-sonnet-4-5-20250929'];
  return PRICING['gpt-4o'];
}

function estimateCostUsd(modelId: string, usage: UsageLike | null | undefined): number {
  const input = Number(usage?.inputTokens) || 0;
  const output = Number(usage?.outputTokens) || 0;
  if (!input && !output) return 0;
  const { input: inRate, output: outRate } = ratesForModel(modelId);
  const cost = (input / 1_000_000) * inRate + (output / 1_000_000) * outRate;
  return Math.round(cost * 1e6) / 1e6;
}

function formatCostUsd(usd: unknown): string {
  const n = Number(usd) || 0;
  if (n === 0) return '$0.00';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

module.exports = {
  estimateCostUsd,
  formatCostUsd,
  ratesForModel,
  modelNameFromId,
};
