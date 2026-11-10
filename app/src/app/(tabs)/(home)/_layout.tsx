import { Stack } from 'expo-router';
import { useTheme } from '@/design';

const ios = process.env.EXPO_OS === 'ios';

// iOS draws the native large title over the list; Android's bar has no large title,
// so it keeps only the actions and the screen draws <LargeTitle />.
export default function TabStack() {
  const { color } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerLargeTitle: true,
        headerTransparent: ios,
        headerLargeTitleShadowVisible: false,
        headerShadowVisible: false,
        headerTintColor: color.text,
        headerTitleStyle: { color: color.text },
        headerLargeTitleStyle: { color: color.text },
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: color.bg },
        ...(ios ? {} : { headerTitle: '' }),
      }}
    />
  );
}
