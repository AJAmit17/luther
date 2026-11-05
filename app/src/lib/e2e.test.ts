import { test } from 'node:test';
import assert from 'node:assert/strict';
import { box, fromB64, open, publicOf, sharedKey, toB64, utf8, text } from './e2e.ts';

// The same vector as server/internal/seal/seal_test.go.
const serverPriv = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
const phonePriv = 'ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8=';
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

test('matches the server', () => {
  assert.equal(publicOf(phonePriv), 'NYBy1jZYgNGu6jKa35EhODhR7SGijjt16WXQ0s0WYlQ=');
  const key = sharedKey(phonePriv, publicOf(serverPriv));
  assert.equal(hex(key), '30ec8d89353d0a9f716695bfc640d133ce1d8d51d37d776c63dad0ef8adbb64a');
  const b = box(key, 'req', utf8('hello'), new Uint8Array(12));
  assert.equal(hex(b), '0000000000000000000000004428631082c07a1445559a3e70a24da739c6075358');
  assert.equal(text(open(key, 'req', b)), 'hello');
  assert.throws(() => open(key, 'res', b));
});

test('base64 round trips', () => {
  for (const n of [0, 1, 2, 3, 31, 32, 33]) {
    const b = Uint8Array.from({ length: n }, (_, i) => (i * 37) & 255);
    assert.deepEqual(fromB64(toB64(b)), b);
    assert.deepEqual(fromB64(toB64(b, true)), b);
  }
});
