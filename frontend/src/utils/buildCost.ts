interface BuildCostData {
  totalUsd?: number | null;
  inputTokens?: number;
  outputTokens?: number;
  [key: string]: unknown;
}

function isBuildCostData(v: unknown): v is BuildCostData {
  return !!v && typeof v === 'object';
}

/** Format estimated build LLM cost for display. */
export function formatBuildCost(cost: unknown): string | null {
  if (!isBuildCostData(cost)) return null;
  if (cost.totalUsd == null) return null;
  const usd = Number(cost.totalUsd) || 0;
  if (usd === 0 && !cost.inputTokens) return null;
  if (usd < 0.01) return `~$${usd.toFixed(4)}`;
  if (usd < 1) return `~$${usd.toFixed(3)}`;
  return `~$${usd.toFixed(2)}`;
}

export function buildCostLabel(cost: unknown): string | null {
  const price = formatBuildCost(cost);
  if (!price) return null;
  const c = isBuildCostData(cost) ? cost : null;
  const tokens = c && (c.inputTokens || c.outputTokens)
    ? ` · ${((c.inputTokens as number) || 0).toLocaleString()}↓ ${((c.outputTokens as number) || 0).toLocaleString()}↑ tok`
    : '';
  return `${price}${tokens}`;
}
