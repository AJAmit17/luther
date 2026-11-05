import * as SecureStore from 'expo-secure-store';
import { addUserInteractionListener, after, type LiveActivity } from 'expo-widgets';
import RunActivity, { type RunActivityProps } from '../widgets/RunActivity';
import type { Run } from './protocol.ts';

/** A Live Activity per thread whose agent is working or waiting. ponytail: updated
 *  only while the app runs (feed or background refresh); updating it while iOS keeps
 *  the app suspended needs ActivityKit push. */

// An activity carries no props back, so which thread each one shows is kept here.
const key = 'luther.activities';
const staleMs = 10 * 60_000;

function byThread(): Record<string, string> {
  try {
    return JSON.parse(SecureStore.getItem(key) ?? '{}');
  } catch {
    return {};
  }
}

const save = (m: Record<string, string>) => SecureStore.setItem(key, JSON.stringify(m));

function find(thread: string): LiveActivity<RunActivityProps> | undefined {
  const id = byThread()[thread];
  return id ? RunActivity.getInstances().find((a) => a.getId() === id) : undefined;
}

const props = (r: Run): RunActivityProps => ({ thread: r.thread, title: r.title, phase: r.phase as RunActivityProps['phase'], detail: r.total ? `${r.done ?? 0}/${r.total} · ${r.detail}` : r.detail, startedAt: r.startedAt });

export function showActivity(r: Run) {
  // Dimmed when the app has been away too long to vouch for it.
  const stale = new Date(Date.now() + staleMs);
  const current = find(r.thread);
  if (current) {
    void current.update(props(r), stale);
    return;
  }
  try {
    const a = RunActivity.start(props(r), `luther://thread/${encodeURIComponent(r.thread)}?cwd=${encodeURIComponent(r.cwd)}`, stale);
    save({ ...byThread(), [r.thread]: a.getId() });
  } catch {
    // Live Activities are off for this app, or the system refused another one.
  }
}

/** The card stays up a while to show how the turn ended. */
export function endActivity(r: Run) {
  const a = find(r.thread);
  const { [r.thread]: _, ...rest } = byThread();
  save(rest);
  if (a) void a.end(after(new Date(Date.now() + 15 * 60_000)), props(r));
}

/** The activity's Stop button runs in the app's process, where the Mac's token lives. */
export function onActivityStop(stop: (thread: string) => void) {
  const sub = addUserInteractionListener((e) => {
    if (e.target.startsWith('stop:')) stop(e.target.slice('stop:'.length));
  });
  return () => sub.remove();
}
