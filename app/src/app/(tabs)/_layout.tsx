import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { c } from '@/components/ui';

// The system's tab bar (Liquid Glass on iOS 26+), shrinking while you scroll.
export default function Tabs() {
  return (
    <NativeTabs minimizeBehavior="onScrollDown" tintColor={c.accent as string}>
      <NativeTabs.Trigger name="(home)">
        <NativeTabs.Trigger.Icon sf="desktopcomputer" md="computer" />
        <NativeTabs.Trigger.Label>Mac</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="schedules">
        <NativeTabs.Trigger.Icon sf="calendar.badge.clock" md="schedule" />
        <NativeTabs.Trigger.Label>Schedules</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Icon sf="gearshape" md="settings" />
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
