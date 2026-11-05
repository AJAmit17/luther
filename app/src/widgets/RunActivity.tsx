import { Button, Circle, HStack, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { activityBackgroundTint, buttonBorderShape, buttonStyle, font, foregroundStyle, frame, lineLimit, monospacedDigit, padding, tint } from '@expo/ui/swift-ui/modifiers';
import { createLiveActivity } from 'expo-widgets';

export type RunActivityProps = {
  thread: string;
  title: string;
  phase: 'working' | 'waiting' | 'finished' | 'failed';
  detail: string;
  startedAt: number;
};

/** One agent thread on the lock screen and in the Dynamic Island. Runs in the
 *  widget's own runtime: everything it uses is declared inside the function. */
const RunActivity = (props: RunActivityProps) => {
  'widget';
  const live = props.phase === 'working' || props.phase === 'waiting';
  const color = { working: '#FF9F0A', waiting: '#0A84FF', finished: '#30D158', failed: '#FF453A' }[props.phase];
  const label = { working: 'Working', waiting: 'Needs you', finished: 'Finished', failed: 'Failed' }[props.phase];
  const timer = (style: 'subheadline' | 'caption2', dim: boolean) =>
    live ? (
      <Text
        timerInterval={{ lower: new Date(props.startedAt), upper: new Date(props.startedAt + 1e12) }}
        countsDown={false}
        modifiers={[font({ textStyle: style }), monospacedDigit(), ...(dim ? [foregroundStyle('#FFFFFF99')] : [])]}
      />
    ) : (
      <Text modifiers={[font({ textStyle: style })]}>{label}</Text>
    );
  const dot = (size: number) => <Circle modifiers={[foregroundStyle(color), frame({ width: size, height: size })]} />;
  const status = (
    <HStack spacing={12}>
      <HStack spacing={8}>
        {dot(7)}
        <Text modifiers={[font({ textStyle: 'subheadline' }), foregroundStyle('#FFFFFFB3'), lineLimit(1)]}>{props.detail}</Text>
      </HStack>
      <Spacer />
      {live ? (
        <Button
          label="Stop"
          target={`stop:${props.thread}`}
          modifiers={[buttonStyle('bordered'), buttonBorderShape('capsule'), tint('#FFFFFF'), font({ textStyle: 'footnote', weight: 'semibold' })]}
        />
      ) : null}
    </HStack>
  );
  return {
    banner: (
      <VStack alignment="leading" spacing={8} modifiers={[padding({ horizontal: 18, vertical: 16 }), foregroundStyle('#FFFFFF'), activityBackgroundTint('#000000')]}>
        <HStack alignment="firstTextBaseline">
          <Text modifiers={[font({ textStyle: 'headline' }), lineLimit(1)]}>{props.title}</Text>
          <Spacer />
          {timer('subheadline', true)}
        </HStack>
        {status}
      </VStack>
    ),
    compactLeading: dot(8),
    compactTrailing: <HStack modifiers={[frame({ maxWidth: 40 })]}>{timer('caption2', false)}</HStack>,
    minimal: dot(8),
    expandedLeading: <Text modifiers={[font({ textStyle: 'headline' }), lineLimit(1), padding({ leading: 4 })]}>{props.title}</Text>,
    expandedTrailing: <HStack modifiers={[padding({ trailing: 4 })]}>{timer('subheadline', true)}</HStack>,
    expandedBottom: <HStack modifiers={[padding({ horizontal: 4, top: 4 })]}>{status}</HStack>,
  };
};

export default createLiveActivity('RunActivity', RunActivity);
