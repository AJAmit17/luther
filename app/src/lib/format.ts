/** A home-relative path: /Users/me/code → ~/code. */
export const home = (p: string) => p.replace(/^\/(Users|home)\/[^/]+/, '~').replace(/^\/root(?=\/|$)/, '~');

/** "in 3h" until a future time (ms). */
export function until(t: number) {
  const sec = (t - Date.now()) / 1000;
  if (sec <= 60) return 'any moment';
  if (sec < 3600) return `in ${Math.round(sec / 60)}m`;
  if (sec < 86400) return `in ${Math.round(sec / 3600)}h`;
  return `in ${Math.round(sec / 86400)}d`;
}

/** "3h" since a past time. */
export function ago(t: string | number) {
  const sec = (Date.now() - new Date(t).getTime()) / 1000;
  if (sec < 60) return 'now';
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h`;
  return `${Math.round(sec / 86400)}d`;
}

/** "3h ago", or "just now". */
export function since(t: string | number) {
  const a = ago(t);
  return a === 'now' ? 'just now' : `${a} ago`;
}
