import { Circle, HStack, Image, Link, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { containerBackground, font, foregroundStyle, frame, lineLimit } from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

export type AgentsWidgetProps = {
  mac: string;
  threads: { id: string; title: string; cwd: string; busy: boolean; activity: string }[];
  projects: { name: string; cwd: string }[];
};

/** What's running on the Mac, then recent projects; each row opens it. Runs in
 *  the widget's own runtime: everything it uses is declared inside the function. */
const AgentsWidget = (props: AgentsWidgetProps, environment: WidgetEnvironment) => {
  'widget';
  const max = environment.widgetFamily === 'systemLarge' ? 8 : 3;
  const threads = (props.threads ?? []).slice(0, max);
  const projects = (props.projects ?? []).slice(0, Math.max(0, max - threads.length));
  const q = (s: string) => encodeURIComponent(s);
  return (
    <VStack alignment="leading" spacing={9} modifiers={[frame({ maxWidth: 1000, maxHeight: 1000, alignment: 'topLeading' }), containerBackground('#0A0A0A', 'widget')]}>
      <HStack>
        <Text modifiers={[font({ textStyle: 'caption', weight: 'semibold' }), foregroundStyle('#FA5D19')]}>{(props.mac || 'LUTHER').toUpperCase()}</Text>
        <Spacer />
        <Link destination="luther://send">
          <Image systemName="square.and.pencil" size={17} color="#FFFFFF" />
        </Link>
      </HStack>
      {threads.map((t) => (
        <Link key={t.id} destination={`luther://thread/${q(t.id)}?cwd=${q(t.cwd)}`}>
          <HStack spacing={8}>
            <Circle modifiers={[foregroundStyle(t.busy ? '#FA5D19' : '#4ED273'), frame({ width: 7, height: 7 })]} />
            <Text modifiers={[font({ textStyle: 'subheadline' }), foregroundStyle('#FFFFFF'), lineLimit(1)]}>{t.title}</Text>
            <Spacer />
            <Text modifiers={[font({ textStyle: 'caption2' }), foregroundStyle('#FFFFFF99'), lineLimit(1)]}>{t.busy ? 'Working' : 'Idle'}</Text>
          </HStack>
        </Link>
      ))}
      {projects.map((p) => (
        <Link key={p.cwd} destination={`luther://project?cwd=${q(p.cwd)}&name=${q(p.name)}`}>
          <HStack spacing={8}>
            <Image systemName="folder" size={12} color="#0A84FF" />
            <Text modifiers={[font({ textStyle: 'subheadline' }), foregroundStyle('#FFFFFFCC'), lineLimit(1)]}>{p.name}</Text>
            <Spacer />
          </HStack>
        </Link>
      ))}
      {!threads.length && !projects.length ? <Text modifiers={[font({ textStyle: 'subheadline' }), foregroundStyle('#FFFFFF99')]}>Open Luther to see your agents here.</Text> : null}
      <Spacer />
    </VStack>
  );
};

export default createWidget('AgentsWidget', AgentsWidget);
