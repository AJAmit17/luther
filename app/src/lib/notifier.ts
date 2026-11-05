import * as Notifications from 'expo-notifications';
import type { Run } from './protocol.ts';

/** Local notifications, posted by the app itself from the Mac's run events (feed.ts)
 *  or a background refresh. ponytail: a phone whose app iOS has suspended hears
 *  about a run only at the next refresh; instant delivery to a closed app needs APNs. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

/** Permission and plan asks carry actions: answer without opening the app. */
const ASK = 'luther.ask';
void Notifications.setNotificationCategoryAsync(ASK, [
  { identifier: 'approve', buttonTitle: 'Approve', options: { opensAppToForeground: false, isAuthenticationRequired: true } },
  { identifier: 'deny', buttonTitle: 'Deny', options: { opensAppToForeground: false, isDestructive: true } },
  { identifier: 'reply', buttonTitle: 'Reply…', textInput: { submitButtonTitle: 'Send', placeholder: 'Do this instead…' }, options: { opensAppToForeground: false, isAuthenticationRequired: true } },
]);

export async function requestNotificationPermission() {
  await Notifications.requestPermissionsAsync();
}

export type Opened = { host: string; thread: string; session: string; provider: Run['provider']; cwd: string; prompt?: string };

/** What a notification response asks for: open the thread, or answer its prompt. */
export type Response = { kind: 'open'; o: Opened } | { kind: 'answer'; o: Opened; choice: number; message?: string };

/** The identifier carries the event, so a repeat replaces rather than stacks. */
export function post(id: string, host: string, run: Run, subtitle: string, body: string) {
  const data: Opened = { host, thread: run.thread, session: run.session, provider: run.provider, cwd: run.cwd, prompt: run.prompt };
  const actionable = run.phase === 'waiting' && (run.kind === 'permission' || run.kind === 'plan');
  void Notifications.scheduleNotificationAsync({
    identifier: id,
    content: { title: run.title, subtitle, body, sound: 'default', data, categoryIdentifier: actionable ? ASK : undefined },
    trigger: null,
  });
}

/** Taps and action buttons (also the one that launched the app). */
export function onNotificationResponse(handle: (r: Response) => void) {
  const on = (r: Notifications.NotificationResponse | null) => {
    const d = r?.notification.request.content.data as Partial<Opened> | undefined;
    if (!r || !d?.thread || !d.cwd || !d.session || !d.provider || !d.host) return;
    const o = d as Opened;
    switch (r.actionIdentifier) {
      case 'approve':
        return handle({ kind: 'answer', o, choice: 0 });
      case 'deny':
        return handle({ kind: 'answer', o, choice: -1 });
      case 'reply':
        return handle({ kind: 'answer', o, choice: -1, message: r.userText });
      default:
        return handle({ kind: 'open', o });
    }
  };
  on(Notifications.getLastNotificationResponse());
  const sub = Notifications.addNotificationResponseReceivedListener(on);
  return () => sub.remove();
}
