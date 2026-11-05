import { Alert } from 'react-native';
import type { MenuAction } from '@expo/ui/community/menu';
import { api } from '@/lib/hosts';
import type { Session } from '@/lib/protocol';
import { openThread } from '@/lib/threads';

// A conversation's long-press menu: resume, fork, rename, pin, archive. Titles,
// pins and the archive live on the Mac (~/.luther/sessions.json), not in the
// agent's own store.
export const sessionActions = (s: Session): MenuAction[] => [
  { id: 'open', title: s.live ? 'Open' : 'Resume', image: 'arrow.up.right' },
  { id: 'fork', title: 'Fork a copy', image: 'arrow.branch' },
  { id: 'rename', title: 'Rename', image: 'pencil' },
  { id: 'pin', title: s.pinned ? 'Unpin' : 'Pin', image: s.pinned ? 'pin.slash' : 'pin' },
  { id: 'archive', title: s.archived ? 'Unarchive' : 'Archive', image: s.archived ? 'tray.and.arrow.up' : 'archivebox' },
];

export function onSessionAction(id: string, s: Session, open: () => void, onChange: () => void) {
  const patch = (body: object) =>
    api(`/sessions/${s.provider}/${encodeURIComponent(s.id)}`, { method: 'PATCH', body: JSON.stringify(body) }).then(onChange, (e) => Alert.alert('Error', e.message));
  if (id === 'open') open();
  if (id === 'fork') void openThread({ provider: s.provider, cwd: s.cwd, resume: s.id, fork: true });
  if (id === 'rename') Alert.prompt('Rename', 'Leave it empty to restore the original title.', (title) => patch({ title }), 'plain-text', s.title);
  if (id === 'pin') patch({ pinned: !s.pinned });
  if (id === 'archive') patch({ archived: !s.archived });
}
