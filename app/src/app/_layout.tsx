import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useQuickActionRouting } from 'expo-quick-actions/router';
import { DialogHost, useTheme } from '@/design';
import { StatusBar } from 'expo-status-bar';
import { onActivityStop } from '@/lib/activities';
import { scheduleBackgroundRefresh } from '@/lib/background'; // also defines the task at import
import { useFeed } from '@/lib/feed';
import { currentHost, onHostsChange, post, refreshRoutes, setCurrent } from '@/lib/hosts';
import { onNotificationResponse } from '@/lib/notifier';
import { openThread } from '@/lib/threads';
import { setQuickActions } from '@/lib/quick-actions';
import { restorePick } from '@/components/attachments';

export default function Layout() {
  const [host, setHost] = useState<string | null>(null);
  const { color, dark } = useTheme();
  useQuickActionRouting();

  useEffect(() => {
    setQuickActions();
    void restorePick();
    const sync = () => void currentHost().then((h) => setHost(h?.id ?? null));
    sync();
    void refreshRoutes();
    const hosts = onHostsChange(sync);
    const app = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        sync();
        void refreshRoutes();
      }
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

  // Pushed screens get an opaque header: content (the chat above all) must not
  // scroll under a see-through bar.
  const sheet = { headerShown: false, presentation: 'formSheet', sheetGrabberVisible: true, contentStyle: { backgroundColor: color.surface } } as const;
  const base = dark ? DarkTheme : DefaultTheme;
  const theme = { ...base, colors: { ...base.colors, primary: color.accent, background: color.bg, card: color.bg, text: color.text, border: color.line, notification: color.red } };
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: color.bg }}>
      <KeyboardProvider>
        <ThemeProvider value={theme}>
        <StatusBar style={dark ? 'light' : 'dark'} />
        <Stack
          screenOptions={{
            headerTintColor: color.text,
            headerTitleStyle: { color: color.text },
            headerLargeTitleStyle: { color: color.text },
            headerStyle: { backgroundColor: color.bg },
            headerShadowVisible: false,
            headerTransparent: false,
            headerBackButtonDisplayMode: 'minimal',
            headerTitleAlign: 'center', // Android too, as on iOS
            contentStyle: { backgroundColor: color.bg },
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="thread/[id]" options={{ headerStyle: { backgroundColor: color.surface }, contentStyle: { backgroundColor: color.surface } }} />
          <Stack.Screen name="project" />
          <Stack.Screen name="pair" options={{ title: 'Pair a Mac', presentation: 'modal' }} />
          <Stack.Screen name="new" options={{ ...sheet, sheetAllowedDetents: [0.75, 1] }} />
          <Stack.Screen name="goal" options={{ ...sheet, sheetAllowedDetents: [0.75, 1] }} />
          <Stack.Screen name="compare-new" options={{ ...sheet, sheetAllowedDetents: [1] }} />
          <Stack.Screen name="compares" options={{ title: 'Compare Agents' }} />
          <Stack.Screen name="compare/[id]" options={{ title: 'Comparison' }} />
          <Stack.Screen name="send" options={{ title: 'Send to Luther', presentation: 'modal' }} />
          <Stack.Screen name="browse" options={{ title: 'Pick a Folder' }} />
          <Stack.Screen name="files" options={{ title: 'Files' }} />
          <Stack.Screen name="git" options={{ title: 'Changes' }} />
          <Stack.Screen name="diff" options={{ title: 'Diff' }} />
          <Stack.Screen name="branches" options={{ title: 'Branches and Stashes' }} />
          <Stack.Screen name="health" options={{ title: 'Health' }} />
          <Stack.Screen name="log" options={{ title: 'Server Log' }} />
          <Stack.Screen name="worktrees" options={{ title: 'Worktrees' }} />
          <Stack.Screen name="turns" options={{ title: 'Turns' }} />
          <Stack.Screen name="runs" options={{ title: 'Reports' }} />
          <Stack.Screen name="preview" options={{ title: 'Preview' }} />
          <Stack.Screen name="instructions" options={{ title: 'Instructions' }} />
          <Stack.Screen name="edit" options={{ title: 'Edit' }} />
          <Stack.Screen name="schedule" options={{ title: 'Schedule', presentation: 'modal' }} />
          <Stack.Screen name="term/[name]" options={{ title: 'Terminal' }} />
        </Stack>
        {host && <Feed key={host} host={host} />}
        <DialogHost />
        </ThemeProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

/** The current Mac's run events, for as long as the app runs. */
function Feed({ host }: { host: string }) {
  useFeed(host);
  return null;
}

export { ErrorBoundary } from '@/components/error-boundary';
