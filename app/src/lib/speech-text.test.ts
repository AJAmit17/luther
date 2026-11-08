import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toSpeech } from './speech-text.ts';

test('reads markdown as plain speech', () => {
  const md = '## Done\n\nI fixed **the bug** in `auth.ts`. See [the PR](https://x.y).\n\n```ts\nconst a = 1;\n```\n\n- one\n- two';
  assert.equal(toSpeech(md), 'Done\nI fixed the bug in auth.ts. See the PR.\n (a code block) \none\ntwo');
});
