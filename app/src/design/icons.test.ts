import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

// Every icon name written in the app's code has a Phosphor match in icons.ts;
// a missing one would draw a question mark (and only warn in development).

const src = new URL('..', import.meta.url);
const files = (dir: URL): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? (e.name === 'widgets' ? [] : files(new URL(e.name + '/', dir))) : /\.tsx?$/.test(e.name) ? [new URL(e.name, dir).pathname] : [],
  );

test('every icon name used in the app is mapped', () => {
  const mapped = new Set([...readFileSync(new URL('icons.ts', import.meta.url), 'utf8').matchAll(/^ {2}'?([a-z0-9.]+)'?: \{ icon:/gm)].map((m) => m[1]));
  const used = new Set<string>();
  for (const f of files(src)) {
    const code = readFileSync(f, 'utf8');
    for (const m of code.matchAll(/<Icon\s[^>]*?\bname="([a-z0-9.]+)"|\bicon="([a-z0-9.]+)"|\b(?:icon|image): '([a-z0-9.]+)'/g)) used.add(m[1] ?? m[2] ?? m[3]);
  }
  const missing = [...used].filter((n) => !mapped.has(n));
  assert.deepEqual(missing, [], `add these to src/design/icons.ts: ${missing.join(', ')}`);
  assert.ok(used.size > 40, `only found ${used.size} icon names; the scan is broken`);
});

test('every mapped icon is used somewhere', () => {
  const map = readFileSync(new URL('icons.ts', import.meta.url), 'utf8');
  const code = files(src).filter((f) => !f.endsWith('/design/icons.ts')).map((f) => readFileSync(f, 'utf8')).join('\n');
  const unused = [...map.matchAll(/^ {2}'?([a-z0-9.]+)'?: \{ icon:/gm)].map((m) => m[1]).filter((n) => !code.includes(`'${n}'`) && !code.includes(`"${n}"`));
  assert.deepEqual(unused, [], `remove these from src/design/icons.ts: ${unused.join(', ')}`);
});
