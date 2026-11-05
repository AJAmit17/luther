import { Stack } from 'expo-router';
import { usePushTaps } from '@/lib/push';
import { c } from '@/lib/ui';

export default function Layout() {
  usePushTaps();
  return (
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
    </Stack>
  );
}
