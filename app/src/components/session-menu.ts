import { Alert } from 'react-native';
import { api } from '@/lib/hosts';
import type { Session } from '@/lib/protocol';
import { openThread } from '@/lib/threads';

// Long-press on a conversation: resume, fork, rename, pin, archive. Titles, pins
// and the archive live on the Mac (~/.luther/sessions.json), not in the agent's store.
export function sessionMenu(s: Session, open: () => void, onChange: () => void) {
  const patch = (body: object) =>
    api(`/sessions/${s.provider}/${encodeURIComponent(s.id)}`, { method: 'PATCH', body: JSON.stringify(body) }).then(onChange, (e) => Alert.alert('Error', e.message));
  Alert.alert(s.title || 'Conversation', s.preview || undefined, [
    { text: 'Resume', onPress: open },
    { text: 'Fork a copy', onPress: () => openThread({ provider: s.provider, cwd: s.cwd, resume: s.id, fork: true }) },
    { text: 'Rename', onPress: () => Alert.prompt('Rename', 'Empty restores the original title.', (title) => patch({ title }), 'plain-text', s.title) },
    { text: s.pinned ? 'Unpin' : 'Pin', onPress: () => patch({ pinned: !s.pinned }) },
    { text: s.archived ? 'Unarchive' : 'Archive', onPress: () => patch({ archived: !s.archived }) },
    { text: 'Cancel', style: 'cancel' },
  ]);
}
