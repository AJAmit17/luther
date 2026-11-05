import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { Stack } from 'expo-router';
import { useQuickActionRouting } from 'expo-quick-actions/router';
import { c } from '@/components/ui';
import { onActivityStop } from '@/lib/activities';
import { scheduleBackgroundRefresh } from '@/lib/background'; // also defines the task at import
import { useFeed } from '@/lib/feed';
import { currentHost, onHostsChange, post, setCurrent } from '@/lib/hosts';
import { onNotificationResponse } from '@/lib/notifier';
import { openThread } from '@/lib/threads';
import { setQuickActions } from '@/lib/quick-actions';

export default function Layout() {
  const [host, setHost] = useState<string | null>(null);
  useQuickActionRouting();

  useEffect(() => {
    setQuickActions();
    const sync = () => void currentHost().then((h) => setHost(h?.id ?? null));
    sync();
    const hosts = onHostsChange(sync);
    const app = AppState.addEventListener('change', (s) => {
      if (s === 'active') sync();
      if (s === 'background') scheduleBackgroundRefresh();
    });
    // A tap opens the thread on the Mac that sent it (resuming it if it stopped);
    // an action button answers the prompt there without opening anything.
    const taps = onNotificationResponse(async (r) => {
      await setCurrent(r.o.host);
      if (r.kind === 'open') return openThread({ provider: r.o.provider, cwd: r.o.cwd, resume: r.o.session });
      if (!r.o.prompt) return;
      await post(`/threads/${encodeURIComponent(r.o.thread)}/answer`, { id: r.o.prompt, choice: r.choice, message: r.message }).catch(() => {
        // Already answered elsewhere, or the thread stopped: show it.
        void openThread({ provider: r.o.provider, cwd: r.o.cwd, resume: r.o.session });
      });
    });
    const stops = onActivityStop((thread) => void post(`/threads/${encodeURIComponent(thread)}/interrupt`, {}).catch(() => {}));
    return () => {
      hosts();
      app.remove();
      taps();
      stops();
    };
  }, []);

  return (
    <>
      <Stack
        screenOptions={{
          headerTintColor: c.accent as any,
          headerBackButtonDisplayMode: 'minimal',
          contentStyle: { backgroundColor: c.bg as any },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Luther', headerLargeTitle: true }} />
        <Stack.Screen name="project" options={{ headerLargeTitle: true }} />
        <Stack.Screen name="pair" options={{ title: 'Pair a Mac', presentation: 'modal' }} />
        <Stack.Screen name="new" options={{ title: 'New thread', presentation: 'formSheet', sheetAllowedDetents: [0.6, 1], sheetGrabberVisible: true }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        <Stack.Screen name="browse" options={{ title: 'Pick a folder' }} />
        <Stack.Screen name="send" options={{ title: 'Send to Luther', presentation: 'modal' }} />
      </Stack>
      {host && <Feed key={host} host={host} />}
    </>
  );
}

/** The current Mac's run events, for as long as the app runs. */
function Feed({ host }: { host: string }) {
  useFeed(host);
  return null;
}
