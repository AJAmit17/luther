import { useEffect } from 'react';
import { Pressable, View, type LayoutChangeEvent } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Text } from './text';
import { useTheme } from './theme';
import { motion, radius, shadow } from './tokens';

export function Segmented<T extends string | number>({ options, value, onChange, small }: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  small?: boolean;
}) {
  const { color } = useTheme();
  const width = useSharedValue(0);
  const index = Math.max(0, options.findIndex((o) => o.id === value));
  const at = useSharedValue(index);
  useEffect(() => {
    at.set(withTiming(index, motion.glide));
  }, [index, at]);
  const thumb = useAnimatedStyle(() => ({ width: width.get(), transform: [{ translateX: at.get() * width.get() }] }));
  const height = small ? 28 : 34;
  return (
    <View
      accessibilityRole="tablist"
      onLayout={(e: LayoutChangeEvent) => width.set((e.nativeEvent.layout.width - 6) / options.length)}
      style={{ flexDirection: 'row', backgroundColor: color.muted, borderRadius: radius.control, borderCurve: 'continuous', padding: 3 }}
    >
      <Animated.View style={[{ position: 'absolute', top: 3, left: 3, height, borderRadius: radius.control - 2, borderCurve: 'continuous', backgroundColor: color.thumb, boxShadow: shadow.thumb }, thumb]} />
      {options.map((o) => {
        const on = o.id === value;
        return (
          <Pressable
            key={String(o.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => {
              if (on) return;
              void Haptics.selectionAsync();
              onChange(o.id);
            }}
            style={{ flex: 1, height, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text variant={small ? 'caption' : 'subhead'} weight="medium" color={on ? 'text' : 'dim'}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
