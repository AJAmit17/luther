import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chartDays, providerTotals, tokenTotal } from './usage.ts';

test('token burn includes cache reads and writes exactly once', () => {
  assert.equal(tokenTotal({ inputTokens: 10, outputTokens: 5, cacheReadTokens: 20, cacheWriteTokens: 2 }), 37);
});

test('charts handle zero days and scale tokens separately from cost', () => {
  const days = [{ date: '2026-11-01', inputTokens: 0, outputTokens: 0 }, { date: '2026-11-02', inputTokens: 100, outputTokens: 100, costUsd: 0.1 }];
  assert.deepEqual(chartDays(days, 'tokens').map((d) => d.fraction), [0, 1]);
  assert.deepEqual(chartDays(days, 'cost').map((d) => d.value), [0, 0.1]);
  assert.deepEqual(chartDays([], 'tokens'), []);
});

test('provider totals combine models without inventing unavailable costs', () => {
  const rows = providerTotals([{ provider: 'claude', model: 'a', inputTokens: 10, outputTokens: 5 }, { provider: 'claude', model: 'b', inputTokens: 20, outputTokens: 15 }, { provider: 'devin', inputTokens: 7, outputTokens: 8, costUsd: 0.02, costReported: true }]);
  assert.equal(rows.length, 2);
  assert.equal(tokenTotal(rows[0]), 50);
  assert.equal(rows[0].costReported, undefined);
  assert.equal(rows[1].costReported, true);
});
