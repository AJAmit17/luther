import type { Msg } from './protocol.ts';

/** The chat as it reads: messages, the agent's steps between two messages folded
 *  into one work card, and each subagent call as its own card with its steps.
 *  No React Native imports: node --test runs it. */
export type Block =
  | { kind: 'msg'; id: string; m: Msg }
  | { kind: 'work'; id: string; steps: Msg[] }
  | { kind: 'agent'; id: string; m: Msg; steps: Msg[] };

export const isAgentTool = (m: Msg) => m.role === 'tool' && (m.tool === 'Task' || m.tool === 'Agent');

export function toBlocks(msgs: Msg[]): Block[] {
  const out: Block[] = [];
  const agents = new Map<string, Msg[]>();
  let work: Msg[] | null = null;
  for (const m of msgs) {
    if (m.parent) {
      agents.set(m.parent, [...(agents.get(m.parent) ?? []), m]);
      continue;
    }
    if (m.role === 'tool' && !isAgentTool(m)) {
      if (!work) {
        work = [];
        out.push({ kind: 'work', id: 'w:' + m.id, steps: work });
      }
      work.push(m);
      continue;
    }
    work = null;
    out.push(isAgentTool(m) ? { kind: 'agent', id: m.id, m, steps: [] } : { kind: 'msg', id: m.id, m });
  }
  return out.map((b) => (b.kind === 'agent' ? { ...b, steps: agents.get(b.id) ?? [] } : b));
}

const kinds: [RegExp, string, string][] = [
  [/^(Bash|Shell|execute)$/, 'ran', 'command'],
  [/^(Edit|Write|MultiEdit|NotebookEdit|Delete|Move)$/, 'edited', 'file'],
  [/^Read$/, 'read', 'file'],
  [/^(Grep|Glob|Search|LS)$/, 'searched', 'time'],
  [/^(WebSearch|WebFetch|Fetch)$/, 'looked up', 'page'],
];

/** "Ran 3 commands, edited 2 files" for a finished work card. */
export function workSummary(steps: Msg[]): string {
  const counts = new Map<string, { verb: string; noun: string; n: number }>();
  let other = 0;
  for (const s of steps) {
    const k = kinds.find(([re]) => re.test(s.tool ?? ''));
    if (!k) {
      other++;
      continue;
    }
    const cur = counts.get(k[1]) ?? { verb: k[1], noun: k[2], n: 0 };
    cur.n++;
    counts.set(k[1], cur);
  }
  const parts = [...counts.values()].map(({ verb, noun, n }) => (noun === 'time' ? `${verb} ${n === 1 ? 'once' : `${n} times`}` : `${verb} ${n} ${noun}${n === 1 ? '' : 's'}`));
  if (other) parts.push(`${other} other step${other === 1 ? '' : 's'}`);
  const s = parts.join(', ') || `${steps.length} steps`;
  return s[0].toUpperCase() + s.slice(1);
}
