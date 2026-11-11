import { useEffect, useRef, type ComponentRef } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';
import { Note, Text, space, useTheme } from '@/design';
import { useLoad } from '@/lib/use-load';
import { api } from '@/lib/hosts';

// The end of the server's log (~/.luther/serve.log), newest at the bottom.
export default function LogScreen() {
  const { color } = useTheme();
  const { data, error, pull } = useLoad(() => api<string>('/logs?lines=600'), []);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  useEffect(() => {
    if (data) setTimeout(() => scroll.current?.scrollToEnd({ animated: false }), 50);
  }, [data]);
  return (
    <>
      <Stack.Screen options={{ title: 'Server Log' }} />
      <ScrollView ref={scroll} style={{ flex: 1, backgroundColor: color.bg }} contentInsetAdjustmentBehavior="automatic" refreshControl={<RefreshControl {...pull} />}>
        {!!error && (
          <View style={{ padding: space.md, paddingBottom: 0 }}>
            <Note tone="danger">{error}</Note>
          </View>
        )}
        <ScrollView horizontal contentContainerStyle={{ padding: space.md }}>
          <Text selectable mono variant="caption2" color="text">{data ?? ''}</Text>
        </ScrollView>
      </ScrollView>
    </>
  );
}
