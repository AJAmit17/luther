import type { Run } from './protocol.ts';

/** What one run update means for the phone: a notification to post, and what its
 *  Live Activity does. Pure, so the feed (app running) and the background refresh
 *  (app woken now and then) decide the same way. */
export type Decision = {
  notify?: { id: string; subtitle: string; body: string };
  activity: 'show' | 'end' | 'none';
};

/** Turns shorter than this end without a notification: you were probably watching. */
export const quietMs = 20_000;

/** watching: this thread is on screen with the app in front, so nothing needs announcing. */
export function decide(prev: Run | undefined, next: Run, watching: boolean): Decision {
  switch (next.phase) {
    case 'working':
      return { activity: 'show' };
    case 'waiting': {
      const fresh = prev?.phase !== 'waiting' || prev.detail !== next.detail;
      return {
        activity: 'show',
        notify: fresh && !watching ? { id: `ask-${next.thread}-${next.startedAt}-${hash(next.detail)}`, subtitle: 'Needs your input', body: next.detail } : undefined,
      };
    }
    case 'finished':
    case 'failed': {
      // Only the transition announces: a repeat (reconnect, background poll) of the same end is silent.
      const ended = prev !== undefined && (prev.phase === 'working' || prev.phase === 'waiting' || prev.endedAt !== next.endedAt);
      if (!ended) return { activity: 'none' };
      const long = (next.endedAt ?? 0) - next.startedAt >= quietMs;
      const say = !watching && (next.phase === 'failed' || long);
      return {
        activity: 'end',
        notify: say ? { id: `end-${next.thread}-${next.endedAt}`, subtitle: next.phase === 'failed' ? 'Failed' : 'Finished', body: next.detail } : undefined,
      };
    }
  }
  return { activity: 'none' };
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
