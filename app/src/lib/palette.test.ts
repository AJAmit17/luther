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

test('Text and functional colors and functional colors remain readable in both appearances', () => {
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

test('Heat takes a dark foreground on its bright dark-mode fill', () => {
  assert.equal(PALETTE.accent[0], '#C2410C');
  assert.equal(PALETTE.accent[1], '#FA5D19');
  assert.equal(PALETTE.onAccent[0], '#FFFFFF');
  assert.equal(PALETTE.onAccent[1], '#0A0A0A');
  assert.ok(contrast('#FFFFFF', PALETTE.accent[1]) < 4.5);
});
