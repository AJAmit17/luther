import type { Usage, UsageBreakdown, UsageDay } from './protocol.ts';

export const tokenTotal = (u: Usage) => u.inputTokens + u.outputTokens + (u.cacheReadTokens ?? 0) + (u.cacheWriteTokens ?? 0);
export type TokenFormat = 'compact' | 'full';
const tokenUnits = ['', 'K', 'M', 'B', 'T'];
const fullTokenFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export function formatTokens(n: number, format: TokenFormat = 'compact') {
  if (format === 'full') return fullTokenFormat.format(n);
  let value = n;
  let unit = 0;
  while (Math.abs(value) >= 1000 && unit < tokenUnits.length - 1) {
    value /= 1000;
    unit++;
  }
  value = Number(value.toFixed(2));
  if (Math.abs(value) >= 1000 && unit < tokenUnits.length - 1) {
    value /= 1000;
    unit++;
  }
  return `${value}${tokenUnits[unit]}`;
}

export function chartDays(days: UsageDay[], metric: 'tokens' | 'cost') {
  const values = days.map((d) => metric === 'tokens' ? tokenTotal(d) : (d.costUsd ?? 0));
  const max = Math.max(Number.EPSILON, ...values);
  return days.map((day, i) => ({ day, value: values[i], fraction: values[i] / max }));
}

export function providerTotals(rows: UsageBreakdown[]): UsageBreakdown[] {
  const totals = new Map<UsageBreakdown['provider'], UsageBreakdown>();
  for (const r of rows) {
    const u = totals.get(r.provider) ?? { provider: r.provider, inputTokens: 0, outputTokens: 0 };
    u.inputTokens += r.inputTokens;
    u.outputTokens += r.outputTokens;
    u.cacheReadTokens = (u.cacheReadTokens ?? 0) + (r.cacheReadTokens ?? 0);
    u.cacheWriteTokens = (u.cacheWriteTokens ?? 0) + (r.cacheWriteTokens ?? 0);
    u.costUsd = (u.costUsd ?? 0) + (r.costUsd ?? 0);
    u.costReported = u.costReported || r.costReported;
    totals.set(r.provider, u);
  }
  return [...totals.values()];
}
