import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useTheme } from './theme';
import { motion, shadow } from './tokens';

/** A stepped slider: `onMove` once per stop crossed, `onChange` where you let go; screen readers step it. */
export function StepSlider({ count, value, label, text, onMove, onChange }: {
  count: number;
  value: number;
  label: string;
  text: (i: number) => string;
  onMove: (i: number) => void;
  onChange: (i: number) => void;
}) {
  const { color } = useTheme();
  const last = Math.max(1, count - 1);
  const width = useSharedValue(0);
  const x = useSharedValue(value); // where the thumb is drawn
  const stop = useSharedValue(value); // the stop under the finger
  const [dragging, setDragging] = useState<number | null>(null); // for the dots
  const shown = dragging ?? value;
  useEffect(() => {
    x.set(withTiming(value, motion.glide));
    stop.set(value);
  }, [value, x, stop]);
  const move = (i: number) => {
    setDragging(i);
    onMove(i);
  };
  const release = (i: number | null) => {
    setDragging(null);
    if (i !== null) onChange(i);
  };
  const nearest = (px: number) => {
    'worklet';
    return Math.min(last, Math.max(0, Math.round((px / Math.max(1, width.get())) * last)));
  };
  const follow = (px: number) => {
    'worklet';
    const s = nearest(px);
    x.set(withTiming(s, { duration: motion.follow }));
    if (s !== stop.get()) {
      stop.set(s);
      scheduleOnRN(move, s);
    }
  };
  const pan = Gesture.Pan()
    .minDistance(0)
    .onBegin((e) => follow(e.x))
    .onUpdate((e) => follow(e.x))
    .onEnd(() => scheduleOnRN(release, stop.get()))
    .onFinalize((_, ok) => {
      if (!ok) scheduleOnRN(release, null); // cancelled: nothing committed
    });
  const fill = useAnimatedStyle(() => ({ width: (x.get() / last) * width.get() }));
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: (x.get() / last) * width.get() - 14 }] }));
  const step = (d: number) => {
    const i = Math.min(last, Math.max(0, value + d));
    if (i !== value) onChange(i);
  };
  return (
    <GestureDetector gesture={pan}>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ min: 0, max: last, now: shown, text: text(shown) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => step(e.nativeEvent.actionName === 'increment' ? 1 : -1)}
        onLayout={(e) => width.set(e.nativeEvent.layout.width)}
        style={{ height: 32, justifyContent: 'center', marginHorizontal: 14 }}
      >
        <View style={{ height: 4, borderRadius: 2, backgroundColor: color.muted }} />
        <Animated.View style={[{ position: 'absolute', left: 0, height: 4, borderRadius: 2, backgroundColor: color.accent }, fill]} />
        {Array.from({ length: count }, (_, i) => (
          <View key={i} style={{ position: 'absolute', left: `${(i / last) * 100}%`, marginLeft: -3, width: 6, height: 6, borderRadius: 3, backgroundColor: i <= shown ? color.onAccent : color.faint }} />
        ))}
        <Animated.View style={[{ position: 'absolute', left: 0, width: 28, height: 28, borderRadius: 14, backgroundColor: '#FFFFFF', boxShadow: shadow.knob }, thumb]} />
      </View>
    </GestureDetector>
  );
}
