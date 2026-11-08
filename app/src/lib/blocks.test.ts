import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toBlocks, workSummary } from './blocks.ts';
import type { Msg } from './protocol.ts';

const m = (id: string, role: Msg['role'], tool?: string, parent?: string): Msg => ({ id, role, text: id, tool, parent });

test('folds steps between messages, and subagents with their steps', () => {
  const b = toBlocks([
    m('u1', 'user'),
    m('t1', 'tool', 'Read'),
    m('t2', 'tool', 'Bash'),
    m('a1', 'assistant'),
    m('task', 'tool', 'Task'),
    m('s1', 'tool', 'Grep', 'task'),
    m('s2', 'assistant', undefined, 'task'),
    m('t3', 'tool', 'Edit'),
    m('a2', 'assistant'),
  ]);
  assert.deepEqual(b.map((x) => x.kind + ':' + x.id), ['msg:u1', 'work:w:t1', 'msg:a1', 'agent:task', 'work:w:t3', 'msg:a2']);
  const work = b[1];
  assert.equal(work.kind === 'work' && work.steps.length, 2);
  const agent = b[3];
  assert.deepEqual(agent.kind === 'agent' && agent.steps.map((s) => s.id), ['s1', 's2']);
});

test('summarises steps', () => {
  assert.equal(workSummary([m('1', 'tool', 'Bash'), m('2', 'tool', 'Bash'), m('3', 'tool', 'Edit')]), 'Ran 2 commands, edited 1 file');
  assert.equal(workSummary([m('1', 'tool', 'Grep'), m('2', 'tool', 'mcp.x')]), 'Searched once, 1 other step');
  assert.equal(workSummary([m('1', 'tool', 'Read'), m('2', 'tool', 'Read')]), 'Read 2 files');
});

test('an artifact card stands on its own between steps', () => {
  const b = toBlocks([
    { id: '1', role: 'tool', tool: 'Bash', text: 'ls' },
    { id: 'art-1', role: 'artifact', text: 'Walkthrough' },
    { id: '2', role: 'tool', tool: 'Read', text: 'x' },
  ]);
  assert.deepEqual(b.map((x) => x.kind), ['work', 'msg', 'work']);
});
