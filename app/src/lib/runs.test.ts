import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decide } from './runs.ts';
import type { Run } from './protocol.ts';

const run = (over: Partial<Run>): Run => ({ thread: 't', session: 's', provider: 'claude', cwd: '/x', title: 'Claude · x', phase: 'working', detail: '', startedAt: 0, ...over });

test('working shows the activity and never notifies', () => {
  assert.deepEqual(decide(undefined, run({ phase: 'working' }), false), { activity: 'show' });
});

test('waiting notifies once per question, never while watching', () => {
  const ask = run({ phase: 'waiting', detail: 'Allow Bash? $ ls' });
  assert.equal(decide(run({ phase: 'working' }), ask, false).notify?.subtitle, 'Needs your input');
  assert.equal(decide(ask, ask, false).notify, undefined); // repeat of the same ask
  assert.ok(decide(ask, { ...ask, detail: 'Allow Edit?' }, false).notify); // a new ask
  assert.equal(decide(run({ phase: 'working' }), ask, true).notify, undefined);
});

test('an end announces only long or failed turns, and only on the transition', () => {
  const working = run({ phase: 'working', startedAt: 1000 });
  const quick = run({ phase: 'finished', startedAt: 1000, endedAt: 5000, detail: 'done' });
  const long = { ...quick, endedAt: 60_000 };
  assert.deepEqual(decide(working, quick, false), { activity: 'end', notify: undefined });
  assert.equal(decide(working, long, false).notify?.subtitle, 'Finished');
  assert.equal(decide(working, { ...quick, phase: 'failed' }, false).notify?.subtitle, 'Failed');
  assert.equal(decide(long, long, false).activity, 'none'); // reconnect replays the same end
  assert.equal(decide(undefined, long, false).activity, 'none'); // first sight after install: no history to announce
});
