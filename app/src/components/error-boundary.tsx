import type { ErrorBoundaryProps } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { Button, EmptyState, Text, space, useTheme } from '@/design';

/** What a screen shows instead of crashing the app when it throws while rendering. */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const { color } = useTheme();
  return (
    <ScrollView style={{ flex: 1, backgroundColor: color.bg }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: space.lg }}>
      <EmptyState icon="exclamationmark.triangle" title="This screen hit a problem" message="The rest of Luther is fine. Try again, or go back." action={<Button variant="primary" label="Try Again" onPress={() => void retry()} />} />
      <View style={{ padding: space.md }}>
        <Text selectable mono variant="caption">{error.message}</Text>
      </View>
    </ScrollView>
  );
}
