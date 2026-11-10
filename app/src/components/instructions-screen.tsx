import { RefreshControl, ScrollView } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Group, ListItem, Note, Pill, Skeleton, space, useTheme } from '@/design';
import { HttpError, api } from '@/lib/hosts';
import type { FileContent } from '@/lib/protocol';
import { useLoad } from '@/lib/use-load';

// The project's instruction files each agent reads first. Personal ones (~/.claude,
// ~/.codex) stay Mac-only: Luther never writes into the agents' own folders.
const FILES = [
  { path: 'CLAUDE.md', who: 'Claude Code', about: 'Shared with the team (commit it)' },
  { path: 'CLAUDE.local.md', who: 'Claude Code', about: 'Just you (keep it out of git)' },
  { path: '.claude/CLAUDE.md', who: 'Claude Code', about: 'Alternative location' },
  { path: 'AGENTS.md', who: 'Codex, OpenCode, Cursor', about: 'Read by most other agents' },
  { path: 'GEMINI.md', who: 'Gemini CLI', about: 'Gemini’s own' },
];

const TEMPLATE = `# Project instructions

## Commands
- Build:
- Test:

## Conventions
- 
`;

export default function Instructions() {
  const { color } = useTheme();
  const { cwd } = useLocalSearchParams<{ cwd: string }>();
  const { data, error, pull } = useLoad(
    () =>
      Promise.all(
        FILES.map((f) =>
          api<FileContent>(`/files?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(f.path)}`).then(
            (fc) => fc.text.split('\n').length,
            (e) => (e instanceof HttpError && e.status === 404 ? 0 : Promise.reject(e)),
          ),
        ),
      ),
    [cwd],
  );
  return (
    <ScrollView style={{ flex: 1, backgroundColor: color.bg }} contentContainerStyle={{ padding: space.lg, gap: space.sm }} contentInsetAdjustmentBehavior="automatic" refreshControl={<RefreshControl {...pull} />}>
      <Stack.Screen options={{ title: 'Instructions' }} />
      {!!error && <Note tone="danger">{error}</Note>}
      <Group title={cwd.split('/').pop() || 'Project'} footer="Agents read these when a conversation starts; a running one picks up changes in its next conversation.">
        {FILES.map((f, i) => {
          const lines = data?.[i] ?? 0;
          return (
            <ListItem
              key={f.path}
              icon={lines ? 'doc.text' : 'doc.badge.plus'}
              iconColor={lines ? color.accent : color.faint}
              title={f.path}
              subtitle={`${f.who} · ${f.about}`}
              trailing={data ? lines ? <Pill label={`${lines} lines`} /> : <Pill label="Create" tone="accent" icon="plus" /> : error ? undefined : <Skeleton width={56} height={16} round={8} />}
              onPress={() => router.push({ pathname: '/edit', params: { cwd, path: f.path, template: f.path.endsWith('.local.md') ? '' : TEMPLATE } })}
            />
          );
        })}
      </Group>
    </ScrollView>
  );
}
