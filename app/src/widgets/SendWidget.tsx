import { Image, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { containerBackground, font, foregroundStyle, frame, padding, widgetURL } from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

/** One tap from the home or lock screen to a new message for an agent. */
const SendWidget = (_props: object, environment: WidgetEnvironment) => {
  'widget';
  const url = 'luther://send';
  if (environment.widgetFamily === 'accessoryCircular') {
    return <Image systemName="paperplane.fill" size={22} modifiers={[widgetURL(url), containerBackground('#00000000', 'widget')]} />;
  }
  return (
    <VStack alignment="leading" spacing={4} modifiers={[frame({ maxWidth: 1000, maxHeight: 1000, alignment: 'topLeading' }), widgetURL(url), containerBackground('#101716', 'widget')]}>
      <Image systemName="paperplane.fill" size={24} color="#89D5C7" />
      <Spacer />
      <Text modifiers={[font({ textStyle: 'headline' }), foregroundStyle('#FFFFFF')]}>Send to Luther</Text>
      <Text modifiers={[font({ textStyle: 'caption' }), foregroundStyle('#FFFFFF99'), padding({ bottom: 2 })]}>New task for an agent</Text>
    </VStack>
  );
};

export default createWidget('SendWidget', SendWidget);
