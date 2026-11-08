import { test } from 'node:test';
import assert from 'node:assert/strict';
import { highlight, langOf } from './highlight.ts';

const kinds = (text: string, file: string) => highlight(text, langOf(file)!).filter((s) => s.kind !== 'plain').map((s) => `${s.kind}:${s.text}`);

test('highlights a TypeScript line', () => {
  assert.deepEqual(kinds('const x = "a//b" + 42; // note', 'a.ts'), ['keyword:const', 'string:"a//b"', 'number:42', 'comment:// note']);
});

test('block comments, escapes and Python comments', () => {
  assert.deepEqual(kinds('/* a\nb */ return "q\\"x"', 'm.go'), ['comment:/* a\nb */', 'keyword:return', 'string:"q\\"x"']);
  assert.deepEqual(kinds('def f(): # hi\n  return None', 'x.py'), ['keyword:def', 'comment:# hi', 'keyword:return', 'keyword:None']);
});

test('identifiers with digits are not numbers, and the text survives whole', () => {
  assert.deepEqual(kinds('v2 = x1', 'a.js'), []);
  const src = 'func main() {\n\tfmt.Println("hi") // ok\n}\n';
  assert.equal(highlight(src, langOf('main.go')!).map((s) => s.text).join(''), src);
});

test('unknown files are left plain', () => {
  assert.equal(langOf('notes.txt'), null);
  assert.ok(langOf('Dockerfile'));
});
