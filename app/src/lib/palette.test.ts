import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PALETTE } from './palette.ts';

function luminance(hex: string) {
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}

function contrast(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test('Relay text and functional colors remain readable in both appearances', () => {
  for (const i of [0, 1]) {
    for (const background of ['bg', 'surface', 'card', 'muted'] as const) {
      for (const foreground of ['text', 'dim', 'faint', 'accent', 'blue', 'green', 'red', 'warn'] as const) {
        const ratio = contrast(PALETTE[foreground][i], PALETTE[background][i]);
        assert.ok(ratio >= 4.5, `${i} ${foreground}/${background}: ${ratio}`);
      }
    }
    assert.ok(contrast(PALETTE.onAccent[i], PALETTE.accent[i]) >= 4.5);
  }
});

test('Relay uses an explicit dark foreground on its pale dark-mode action fill', () => {
  assert.equal(PALETTE.accent[0], '#086B64');
  assert.equal(PALETTE.accent[1], '#89D5C7');
  assert.equal(PALETTE.onAccent[0], '#FFFFFF');
  assert.equal(PALETTE.onAccent[1], '#102B26');
  assert.ok(contrast('#FFFFFF', PALETTE.accent[1]) < 3);
});
