import type { Usage, UsageBreakdown, UsageDay } from './protocol.ts';

export const tokenTotal = (u: Usage) => u.inputTokens + u.outputTokens + (u.cacheReadTokens ?? 0) + (u.cacheWriteTokens ?? 0);
export const formatTokens = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n);

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
