import { Stack } from 'expo-router';
import { useHex } from '@/components/ui';

// A tab's own stack: large title drawn over the list (which insets itself).
export default function TabStack() {
  const h = useHex();
  return (
    <Stack
      screenOptions={{
        headerLargeTitle: true,
        headerTransparent: process.env.EXPO_OS === 'ios',
        headerLargeTitleShadowVisible: false,
        headerShadowVisible: false,
        headerTintColor: h.accent,
        headerTitleStyle: { color: h.text },
        headerLargeTitleStyle: { color: h.text },
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: h.bg },
      }}
    />
  );
}
