import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describe, fromCron, toCron } from './cron.ts';

test('presets round trip', () => {
  for (const [p, t, d] of [['hourly', '00:15', 1], ['daily', '07:30', 1], ['weekdays', '09:00', 1], ['weekly', '18:05', 5]] as const) {
    const c = toCron(p, t, d);
    const back = fromCron(c);
    assert.equal(back.preset, p, c);
    if (p !== 'hourly') assert.equal(back.time, t);
    if (p === 'weekly') assert.equal(back.day, d);
  }
});

test('describes', () => {
  assert.equal(describe('0 9 * * 1-5'), 'Weekdays at 9:00');
  assert.equal(describe('30 7 * * *'), 'Every day at 7:30');
  assert.equal(describe('0 * * * *'), 'Every hour');
  assert.equal(describe('5 18 * * 0'), 'Sundays at 18:05');
  assert.equal(describe('0 18 * * 7'), 'Sundays at 18:00');
  assert.equal(describe('*/15 * * * *'), 'cron: */15 * * * *');
  assert.equal(describe('@weekdays'), 'Weekdays at 9:00');
});
