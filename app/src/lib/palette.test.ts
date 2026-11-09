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

test('Text and functional colors remain readable in both appearances', () => {
  for (const i of [0, 1]) {
    for (const background of ['bg', 'surface', 'card', 'muted'] as const) {
      for (const foreground of ['text', 'dim', 'faint', 'blue', 'green', 'red', 'warn'] as const) {
        const ratio = contrast(PALETTE[foreground][i], PALETTE[background][i]);
        assert.ok(ratio >= 4.5, `${i} ${foreground}/${background}: ${ratio}`);
      }
    }
    // heat is a fill and a mark, held to the 3:1 of UI components and large text
    assert.ok(contrast(PALETTE.accent[i], PALETTE.bg[i]) >= 3);
    assert.ok(contrast(PALETTE.onAccent[i], PALETTE.accent[i]) >= 3);
  }
});

test('Heat is the design\'s orange with white on it in both modes', () => {
  for (const i of [0, 1]) {
    assert.equal(PALETTE.accent[i], '#FA5D19');
    assert.equal(PALETTE.onAccent[i], '#FFFFFF');
  }
});
