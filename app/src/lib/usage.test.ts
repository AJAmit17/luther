import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { chartDays, formatTokens, providerTotals, tokenTotal } from './usage.ts';

test('token formatting scales dynamically through thousands, millions, billions and trillions', () => {
  for (const [tokens, expected] of [
    [0, '0'], [654, '654'], [999, '999'], [1_000, '1K'], [131_500, '131.5K'],
    [1_000_000, '1M'], [100_000_000, '100M'], [999_000_000, '999M'],
    [1_000_000_000, '1B'], [3_452_000_000, '3.45B'], [1_000_000_000_000, '1T'],
    [999_999, '1M'], [999_999_999, '1B'],
  ] as const) {
    assert.equal(formatTokens(tokens), expected, String(tokens));
  }
});

test('token formatting stays compact when the runtime ignores Intl compact notation', () => {
  const result = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', `
    const NativeFormat = Intl.NumberFormat;
    Intl.NumberFormat = class extends NativeFormat {
      constructor(locale, options) { super(locale, { ...options, notation: 'standard' }); }
    };
    const { formatTokens } = await import(${JSON.stringify(new URL('./usage.ts', import.meta.url).href)});
    const actual = formatTokens(1_013_839_784);
    if (actual !== '1.01B') throw new Error('Expected 1.01B, got ' + actual);
  `], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('full token formatting preserves the exact grouped count', () => {
  assert.equal(formatTokens(1_013_839_784, 'full'), '1,013,839,784');
  assert.equal(formatTokens(94_059, 'full'), '94,059');
  assert.equal(formatTokens(0, 'full'), '0');
});

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
