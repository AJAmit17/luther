import type { Run } from './protocol.ts';

// ponytail: Live Activities are iOS only; Android's equivalent (a Live Update notification) isn't built.
export function showActivity(_run: Run) {}
export function endActivity(_run: Run) {}
export function onActivityStop(_stop: (thread: string) => void) {
  return () => {};
}
