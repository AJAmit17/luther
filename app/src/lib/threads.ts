import { Alert } from 'react-native';
import { router } from 'expo-router';
import { HttpError, post } from '@/lib/hosts';
import type { OpenReq } from '@/lib/protocol';

/** Attaches to (or starts/resumes) a thread and shows it. A 409 means a CLI outside
 *  Luther has the session open: offer to move it here or fork it. */
export function openThread(req: OpenReq, replace = false): Promise<void> {
  return post<{ id: string }>('/threads', req).then(
    ({ id }) => {
      const to = { pathname: '/thread/[id]' as const, params: { id, cwd: req.cwd } };
      if (replace) router.replace(to);
      else router.push(to);
    },
    (e) =>
      e instanceof HttpError && e.status === 409
        ? Alert.alert('Open in a terminal on your Mac', 'Another CLI has this conversation open. Move it here (that terminal stops; nothing is lost) or fork a copy.', [
            { text: 'Move here', onPress: () => void openThread({ ...req, move: true }, replace) },
            { text: 'Fork a copy', onPress: () => void openThread({ ...req, fork: true }, replace) },
            { text: 'Cancel', style: 'cancel' },
          ])
        : Alert.alert('Could not open', e.message),
  );
}
