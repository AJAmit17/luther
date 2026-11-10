import { useEffect, type ReactNode } from 'react';
import { View } from 'react-native';
import Animated, { Easing, ReduceMotion, useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useTheme } from './theme';

const APath = Animated.createAnimatedComponent(Path);
const ACircle = Animated.createAnimatedComponent(Circle);
const STROKE = 80;
const draw = { duration: 420, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.System };

/** Luther's Relay mark. `animate` draws the two strokes in, one handing off to the other. */
export function RelayMark({ size = 80, animate }: { size?: number; animate?: boolean }) {
  const { color } = useTheme();
  const down = useSharedValue(animate ? 0 : 1);
  const up = useSharedValue(animate ? 0 : 1);
  useEffect(() => {
    if (!animate) return;
    down.set(withTiming(1, draw));
    up.set(withDelay(180, withTiming(1, draw)));
  }, [animate, down, up]);
  const downProps = useAnimatedProps(() => ({ strokeDashoffset: STROKE * (1 - down.get()) }));
  const upProps = useAnimatedProps(() => ({ strokeDashoffset: STROKE * (1 - up.get()) }));
  return (
    <Svg width={size} height={size} viewBox="0 0 80 80" accessibilityLabel="Luther">
      <Rect width={80} height={80} rx={20} fill={color.accent} />
      <APath d="M20 14 L20 43 Q20 55 32 55 L47 55" fill="none" stroke={color.onAccent} strokeWidth={11} strokeDasharray={STROKE} animatedProps={downProps} />
      <APath d="M60 66 L60 37 Q60 25 48 25 L33 25" fill="none" stroke={color.onAccent} strokeWidth={11} strokeDasharray={STROKE} animatedProps={upProps} />
    </Svg>
  );
}

/** A heat arc turning around `children` while an agent works. */
export function WorkingRing({ size, active, children }: { size: number; active: boolean; children: ReactNode }) {
  const { color } = useTheme();
  const turn = useSharedValue(0);
  const shown = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    shown.set(withTiming(active ? 1 : 0, { duration: 180 }));
    turn.set(active ? withRepeat(withTiming(1, { duration: 1400, easing: Easing.linear, reduceMotion: ReduceMotion.System }), -1) : 0);
  }, [active, turn, shown]);
  const spin = useAnimatedStyle(() => ({ opacity: shown.get(), transform: [{ rotate: `${turn.get() * 360}deg` }] }));
  const ring = size + 8;
  const r = ring / 2 - 1.5;
  const arc = useAnimatedProps(() => ({ strokeOpacity: shown.get() }));
  return (
    <View style={{ width: size, height: size }}>
      {children}
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: -4, top: -4, width: ring, height: ring }, spin]}>
        <Svg width={ring} height={ring}>
          <ACircle cx={ring / 2} cy={ring / 2} r={r} fill="none" stroke={color.accent} strokeWidth={2.5} strokeLinecap="round" strokeDasharray={`${r * 1.3} ${r * 6}`} animatedProps={arc} />
        </Svg>
      </Animated.View>
    </View>
  );
}
