/** Format estimated build LLM cost for display. */
export function formatBuildCost(cost) {
  if (!cost || cost.totalUsd == null) return null;
  const usd = Number(cost.totalUsd) || 0;
  if (usd === 0 && !cost.inputTokens) return null;
  if (usd < 0.01) return `~$${usd.toFixed(4)}`;
  if (usd < 1) return `~$${usd.toFixed(3)}`;
  return `~$${usd.toFixed(2)}`;
}

export function buildCostLabel(cost) {
  const price = formatBuildCost(cost);
  if (!price) return null;
  const tokens = cost.inputTokens || cost.outputTokens
    ? ` · ${(cost.inputTokens || 0).toLocaleString()}↓ ${(cost.outputTokens || 0).toLocaleString()}↑ tok`
    : '';
  return `${price}${tokens}`;
}
