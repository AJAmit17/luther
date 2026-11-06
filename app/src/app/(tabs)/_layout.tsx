import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useHex } from '@/components/ui';

// The system's tab bar (Liquid Glass on iOS 26+), shrinking while you scroll.
export default function Tabs() {
  const h = useHex();
  return (
    <NativeTabs minimizeBehavior="onScrollDown" tintColor={h.accent} {...(process.env.EXPO_OS === 'android' ? { labelVisibilityMode: 'labeled' as const, backgroundColor: h.card, indicatorColor: h.muted, iconColor: { default: h.dim, selected: h.accent }, labelStyle: { default: { color: h.dim }, selected: { color: h.accent } } } : {})}>
      <NativeTabs.Trigger name="(home)">
        <NativeTabs.Trigger.Icon sf="desktopcomputer" md="computer" />
        <NativeTabs.Trigger.Label>Mac</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="schedules">
        <NativeTabs.Trigger.Icon sf="calendar.badge.clock" md="schedule" />
        <NativeTabs.Trigger.Label>Schedules</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="usage">
        <NativeTabs.Trigger.Icon sf="chart.bar.xaxis" md="bar_chart" />
        <NativeTabs.Trigger.Label>Usage</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Icon sf="gearshape" md="settings" />
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
