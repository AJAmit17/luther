import { useEffect, type ReactNode } from 'react';
import { View } from 'react-native';
import { NativeTabs } from 'expo-router/native-tabs';
import { TabList, TabSlot, TabTrigger, Tabs as HeadlessTabs, defaultTabsSlotRender } from 'expo-router/ui';
import { usePathname } from 'expo-router';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Icon, Press, Text, radius, shadow, space, tint, useTheme, type IconName, motion } from '@/design';
import { useLoad } from '@/lib/use-load';
import { api } from '@/lib/hosts';
import type { Job } from '@/lib/protocol';
import { news } from '@/components/schedules-screen';

const ios = process.env.EXPO_OS === 'ios';

const TABS: { name: string; href: '/' | '/schedules' | '/usage' | '/settings'; icon: IconName; label: string }[] = [
  { name: '(home)', href: '/', icon: 'desktopcomputer', label: 'Mac' },
  { name: 'schedules', href: '/schedules', icon: 'calendar.badge.clock', label: 'Schedules' },
  { name: 'usage', href: '/usage', icon: 'chart.bar.xaxis', label: 'Usage' },
  { name: 'settings', href: '/settings', icon: 'gearshape', label: 'Settings' },
];

// iOS: the system's tab bar (Liquid Glass), shrinking while you scroll.
// Android: a capsule drawn to match it, instead of Material's navigation bar.
export default function Tabs() {
  const { color } = useTheme();
  // Unread reports of scheduled runs, as a badge on Schedules.
  const { data: jobs } = useLoad(() => api<Job[]>('/schedules'), [], 'schedules');
  const unread = (jobs ?? []).reduce((n, j) => n + news(j), 0);
  if (!ios) return <SharedTabs unread={unread} />;
  return (
    <NativeTabs minimizeBehavior="onScrollDown" tintColor={color.text}>
      {TABS.map((t) => (
        <NativeTabs.Trigger key={t.name} name={t.name}>
          <NativeTabs.Trigger.Icon sf={t.icon} />
          <NativeTabs.Trigger.Label>{t.label}</NativeTabs.Trigger.Label>
          {t.name === 'schedules' && unread > 0 && <NativeTabs.Trigger.Badge>{String(unread)}</NativeTabs.Trigger.Badge>}
        </NativeTabs.Trigger>
      ))}
    </NativeTabs>
  );
}

function SharedTabs({ unread }: { unread: number }) {
  const { color, dark } = useTheme();
  const insets = useSafeAreaInsets();
  const path = usePathname();
  const index = Math.max(0, TABS.findIndex((t) => (t.href === '/' ? path === '/' : path.startsWith(t.href))));
  const width = useSharedValue(0);
  const at = useSharedValue(index);
  useEffect(() => {
    at.set(withTiming(index, motion.glide));
  }, [index, at]);
  const pill = useAnimatedStyle(() => ({ width: width.get(), transform: [{ translateX: at.get() * width.get() }] }));
  return (
    <HeadlessTabs style={{ flex: 1, backgroundColor: color.bg }}>
      <TabSlot renderFn={(descriptor, options) => defaultTabsSlotRender({ ...descriptor, render: () => <FadeIn focused={options.isFocused}>{descriptor.render()}</FadeIn> }, options)} />
      <TabList asChild>
        <View
          onLayout={(e) => width.set((e.nativeEvent.layout.width - space.xs * 2 - 2) / TABS.length)}
          style={{ flexDirection: 'row', marginHorizontal: space.lg + 2, marginTop: space.xs + 2, marginBottom: Math.max(insets.bottom, space.md), padding: space.xs, borderRadius: radius.full, backgroundColor: color.card, borderWidth: 1, borderColor: color.line, boxShadow: dark ? undefined : shadow.raised }}
        >
          <Animated.View style={[{ position: 'absolute', top: space.xs, left: space.xs, height: 54, borderRadius: radius.full, backgroundColor: tint(color.text, 0.08) }, pill]} />
          {TABS.map((t) => (
            <TabTrigger key={t.name} name={t.name} href={t.href} asChild>
              <TabButton icon={t.icon} label={t.label} badge={t.name === 'schedules' ? unread : 0} />
            </TabTrigger>
          ))}
        </View>
      </TabList>
    </HeadlessTabs>
  );
}

/** A tab's screen fades in when it is switched to; it stays mounted, so its scroll and state survive. */
function FadeIn({ focused, children }: { focused: boolean; children: ReactNode }) {
  const shown = useSharedValue(focused ? 1 : 0);
  useEffect(() => {
    shown.set(focused ? withTiming(1, { duration: motion.state }) : 0);
  }, [focused, shown]);
  const fade = useAnimatedStyle(() => ({ opacity: shown.get() }));
  return <Animated.View style={[{ flex: 1 }, fade]}>{children}</Animated.View>;
}

function TabButton({ icon, label, badge, isFocused, ...p }: { icon: IconName; label: string; badge: number; isFocused?: boolean; onPress?: () => void }) {
  const { color } = useTheme();
  const fg = isFocused ? color.text : color.dim;
  return (
    <Press
      {...p}
      onPress={() => {
        void Haptics.selectionAsync();
        p.onPress?.();
      }}
      accessibilityRole="tab"
      accessibilityLabel={badge > 0 ? `${label}, ${badge} new` : label}
      accessibilityState={{ selected: isFocused }}
      style={{ flex: 1, height: 54, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', gap: space.xxs }}
    >
      <View>
        <Icon name={icon} size={22} color={fg} />
        {badge > 0 && (
          <View style={{ position: 'absolute', top: -4, right: -10, minWidth: 16, height: 16, borderRadius: radius.full, paddingHorizontal: space.xs, backgroundColor: color.red, alignItems: 'center', justifyContent: 'center' }}>
            <Text variant="caption2" weight="medium" style={{ color: color.onAccent }}>{badge}</Text>
          </View>
        )}
      </View>
      <Text variant="caption2" weight="medium" style={{ color: fg }}>{label}</Text>
    </Press>
  );
}
