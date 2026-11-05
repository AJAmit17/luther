import { Stack } from 'expo-router';
import { c } from '@/components/ui';

// A tab's own stack: large title drawn over the list (which insets itself).
export default function TabStack() {
  return (
    <Stack
      screenOptions={{
        headerLargeTitle: true,
        headerTransparent: process.env.EXPO_OS === 'ios',
        headerLargeTitleShadowVisible: false,
        headerShadowVisible: false,
        headerTintColor: c.accent as string,
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: c.bg as string },
      }}
    />
  );
}
