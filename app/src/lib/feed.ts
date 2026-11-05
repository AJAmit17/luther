import * as SecureStore from 'expo-secure-store';
import { AppState } from 'react-native';
import { endActivity, showActivity } from './activities';
import { api, currentHost } from './hosts';
import { post } from './notifier.ts';
import type { Run } from './protocol.ts';
import { decide } from './runs.ts';
import { useSocket } from './socket';

/** The Mac's run events → local notifications and Live Activities. Live while the
 *  app runs (WS /events); background.ts replays GET /runs when iOS wakes the app. */

let watching: string | null = null;
/** The thread on screen: its asks and ends need no notification. */
export const setWatching = (thread: string | null) => {
  watching = thread;
};

const key = 'luther.runs';
let last: Record<string, Run> | null = null;

function known(): Record<string, Run> {
  if (!last) {
    try {
      last = JSON.parse(SecureStore.getItem(key) ?? '{}');
    } catch {
      last = {};
    }
  }
  return last!;
}

export function applyRun(run: Run, host: string) {
  const all = known();
  const prev = all[run.thread];
  const d = decide(prev, run, watching === run.thread && AppState.currentState === 'active');
  if (d.notify) post(d.notify.id, host, run, d.notify.subtitle, d.notify.body);
  if (d.activity === 'show') showActivity(run);
  else if (d.activity === 'end') endActivity(run);
  all[run.thread] = run;
  // Keychain writes aren't free: persist on phase changes only (what decide compares across wakes).
  if (prev?.phase !== run.phase || prev.endedAt !== run.endedAt) {
    const day = Date.now() - 86_400_000;
    for (const [t, r] of Object.entries(all)) if (r.endedAt && r.endedAt < day) delete all[t];
    SecureStore.setItem(key, JSON.stringify(all));
  }
}

export function useFeed(host: string) {
  useSocket('/events', (f) => f.type === 'run' && applyRun(f.run, host));
}

export async function refreshRuns() {
  const h = await currentHost();
  if (!h) return;
  for (const r of await api<Run[]>('/runs')) applyRun(r, h.id);
}
