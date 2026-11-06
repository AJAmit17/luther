import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { PALETTE } from './palette.ts';

const config = createRequire(import.meta.url)('../../app.config.js').expo;
const asset = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url));

test('Icon Composer receives closed filled outlines rather than open SVG strokes', () => {
  const svg = readFileSync(new URL('../../assets/luther.icon/Assets/relay.svg', import.meta.url), 'utf8');
  assert.doesNotMatch(svg, /stroke-width=|fill="none"/);
  const paths = [...svg.matchAll(/<path d="([^"]+)"/g)];
  assert.ok(paths.length > 0);
  for (const [, path] of paths) assert.match(path, /Z$/);
});

test('native configuration and generated artwork use the shared Relay palette', () => {
  assert.equal(config.ios.icon, './assets/luther.icon');
  assert.equal(config.android.adaptiveIcon.backgroundColor, PALETTE.accent[0]);
  const splash = config.plugins.find((p: unknown) => Array.isArray(p) && p[0] === 'expo-splash-screen')[1];
  assert.equal(splash.backgroundColor, PALETTE.bg[0]);
  assert.equal(splash.dark.backgroundColor, PALETTE.bg[1]);
  const manifest = JSON.parse(readFileSync(new URL('../../../assets/brand/palette.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest, PALETTE);
});

test('configured bitmap assets have the intended dimensions and alpha format', () => {
  const splash = config.plugins.find((p: unknown) => Array.isArray(p) && p[0] === 'expo-splash-screen')[1];
  for (const [path, size, colorType] of [
    [config.icon, 1024, 2],
    [config.android.adaptiveIcon.foregroundImage, 1024, 6],
    [config.android.adaptiveIcon.monochromeImage, 1024, 6],
    [config.web.favicon, 64, 2],
    [splash.image, 512, 6],
    [splash.dark.image, 512, 6],
  ] as const) {
    const image = asset(path);
    assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', path);
    assert.equal(image.readUInt32BE(16), size, path);
    assert.equal(image.readUInt32BE(20), size, path);
    assert.equal(image[25], colorType, path);
  }
});

test('Apache metadata and project attribution travel with the source', () => {
  const manifest = JSON.parse(asset('package.json').toString());
  const lock = JSON.parse(asset('package-lock.json').toString());
  assert.equal(manifest.license, 'Apache-2.0');
  assert.equal(lock.packages[''].license, 'Apache-2.0');
  const license = readFileSync(new URL('../../../LICENSE', import.meta.url), 'utf8');
  const notice = readFileSync(new URL('../../../NOTICE', import.meta.url), 'utf8');
  assert.match(license, /Version 2\.0, January 2004/);
  assert.match(notice, /Luther/);
  assert.match(notice, /Amit Acharya/);
  assert.match(notice, /https:\/\/github\.com\/AJAmit17\/luther/);
});
