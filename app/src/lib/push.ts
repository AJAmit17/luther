import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { HttpError, post, setCurrent } from '@/lib/hosts';
import type { OpenReq } from '@/lib/protocol';

// The Mac pushes when an agent needs you (permission, question, plan) or finishes
// a long turn. No foreground handler: while the app is open the thread shows it.

export async function registerPush() {
  try {
    const { granted } = await Notifications.requestPermissionsAsync();
    if (!granted) return;
    const { data } = await Notifications.getExpoPushTokenAsync(); // projectId from app.json extra.eas
    await post('/devices/push', { token: data });
  } catch (e: any) {
    console.warn('push registration:', e.message); // simulator, no EAS project, denied
  }
}

// openThread attaches to (or starts/resumes) a thread and shows it. A 409 means a
// CLI outside Luther has the session open: offer to move it here or fork it.
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

// A tap reopens the thread on the Mac that sent it (resuming it if it was stopped).
export function usePushTaps() {
  const res = Notifications.useLastNotificationResponse();
  const handled = useRef('');
  useEffect(() => {
    const id = res?.notification.request.identifier;
    const d = res?.notification.request.content.data as Record<string, string> | undefined;
    if (!id || handled.current === id || !d?.cwd || !d.session) return;
    handled.current = id;
    (async () => {
      if (d.device) await setCurrent(d.device);
      await openThread({ provider: d.provider as OpenReq['provider'], cwd: d.cwd, resume: d.session });
    })();
  }, [res]);
}
