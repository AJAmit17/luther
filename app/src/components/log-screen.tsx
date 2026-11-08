import { useEffect, useRef, type ComponentRef } from 'react';
import { RefreshControl, ScrollView, Text } from 'react-native';
import { Stack } from 'expo-router';
import { api } from '@/lib/hosts';
import { Note, c, mono, useLoad, useHex } from '@/components/ui';

// The end of the server's log (~/.luther/serve.log), newest at the bottom.
export default function LogScreen() {
  useHex();
  const { data, error, pull } = useLoad(() => api<string>('/logs?lines=600'), []);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  useEffect(() => {
    if (data) setTimeout(() => scroll.current?.scrollToEnd({ animated: false }), 50);
  }, [data]);
  return (
    <>
      <Stack.Screen options={{ title: 'Server log' }} />
      <ScrollView ref={scroll} style={{ flex: 1, backgroundColor: c.bg as any }} contentInsetAdjustmentBehavior="automatic" refreshControl={<RefreshControl {...pull} />}>
        {!!error && <Note error>{error}</Note>}
        <ScrollView horizontal contentContainerStyle={{ padding: 12 }}>
          <Text selectable style={{ color: c.text, fontFamily: mono, fontSize: 11, lineHeight: 16 }}>{data ?? ''}</Text>
        </ScrollView>
      </ScrollView>
    </>
  );
}
