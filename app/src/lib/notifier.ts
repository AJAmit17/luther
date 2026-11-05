import * as Notifications from 'expo-notifications';
import type { Run } from './protocol.ts';

/** Local notifications, posted by the app itself from the Mac's run events (feed.ts)
 *  or a background refresh. ponytail: a phone whose app iOS has suspended hears
 *  about a run only at the next refresh; instant delivery to a closed app needs APNs. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

export async function requestNotificationPermission() {
  await Notifications.requestPermissionsAsync();
}

export type Opened = { host: string; thread: string; session: string; provider: Run['provider']; cwd: string };

/** The identifier carries the event, so a repeat replaces rather than stacks. */
export function post(id: string, host: string, run: Run, subtitle: string, body: string) {
  const data: Opened = { host, thread: run.thread, session: run.session, provider: run.provider, cwd: run.cwd };
  void Notifications.scheduleNotificationAsync({
    identifier: id,
    content: { title: run.title, subtitle, body, sound: 'default', data },
    trigger: null,
  });
}

/** The thread a tapped notification opens (also the one that launched the app). */
export function onNotificationOpen(open: (o: Opened) => void) {
  const handle = (r: Notifications.NotificationResponse | null) => {
    const d = r?.notification.request.content.data as Partial<Opened> | undefined;
    if (d?.thread && d.cwd && d.session && d.provider && d.host) open(d as Opened);
  };
  handle(Notifications.getLastNotificationResponse());
  const sub = Notifications.addNotificationResponseReceivedListener(handle);
  return () => sub.remove();
}
