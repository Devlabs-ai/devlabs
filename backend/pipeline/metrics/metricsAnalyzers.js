'use strict';

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function segmentSpike(samples, field, spikeFactor = 2) {
  const vals = samples.map((s) => s[field]).filter((v) => Number.isFinite(v));
  if (vals.length < 4) {
    return { steady: vals, spike: [] };
  }
  const base = median(vals) || 1;
  const threshold = base * spikeFactor;
  const steady = [];
  const spike = [];
  for (const s of samples) {
    const v = s[field];
    if (!Number.isFinite(v)) continue;
    if (v >= threshold) spike.push(v);
    else steady.push(v);
  }
  if (spike.length === 0) {
    return { steady: vals, spike: [] };
  }
  return { steady, spike };
}

function runAlgorithm(algorithm, samples, field, opts = {}) {
  const vals = samples.map((s) => s[field]).filter((v) => Number.isFinite(v));
  if (!vals.length) {
    return { value: null, sampleCount: 0 };
  }

  switch (algorithm) {
    case 'median': {
      const seg = opts.segment === 'spike'
        ? segmentSpike(samples, field).spike
        : opts.segment === 'steady'
          ? segmentSpike(samples, field).steady
          : vals;
      return { value: median(seg), sampleCount: seg.length };
    }
    case 'max':
      return { value: Math.max(...vals), sampleCount: vals.length };
    case 'min':
      return { value: Math.min(...vals), sampleCount: vals.length };
    case 'sum':
      return { value: vals.reduce((a, b) => a + b, 0), sampleCount: vals.length };
    case 'spike_ratio': {
      const { steady, spike } = segmentSpike(samples, field);
      const sMed = median(steady);
      const pMed = median(spike);
      if (!sMed || !pMed || !spike.length) {
        return { value: null, sampleCount: vals.length, steadyMedian: sMed, spikeMedian: pMed };
      }
      return {
        value: Math.round((pMed / sMed) * 100) / 100,
        sampleCount: vals.length,
        steadyMedian: Math.round(sMed),
        spikeMedian: Math.round(pMed),
      };
    }
    case 'dominant_period': {
      const { spike } = segmentSpike(samples, field);
      if (spike.length < 2) {
        return { value: null, sampleCount: vals.length };
      }
      const indices = [];
      const threshold = (median(vals) || 1) * 2;
      samples.forEach((s, i) => {
        if (Number.isFinite(s[field]) && s[field] >= threshold) indices.push(i);
      });
      if (indices.length < 2) return { value: null, sampleCount: vals.length };
      const gaps = [];
      for (let i = 1; i < indices.length; i++) gaps.push(indices[i] - indices[i - 1]);
      const intervalSec = opts.intervalSeconds || 1;
      return {
        value: Math.round(median(gaps) * intervalSec),
        sampleCount: indices.length,
      };
    }
    case 'max_rate_per_minute': {
      const window = 60 / (opts.intervalSeconds || 1);
      let maxSum = 0;
      for (let i = 0; i < vals.length; i += Math.max(1, Math.floor(window))) {
        const chunk = vals.slice(i, i + Math.floor(window));
        maxSum = Math.max(maxSum, chunk.reduce((a, b) => a + b, 0));
      }
      return { value: maxSum, sampleCount: vals.length };
    }
    default:
      return { value: null, sampleCount: vals.length, error: `unknown algorithm ${algorithm}` };
  }
}

module.exports = {
  median,
  segmentSpike,
  runAlgorithm,
};
