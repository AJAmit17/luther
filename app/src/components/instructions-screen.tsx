import { RefreshControl, ScrollView } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { HttpError, api } from '@/lib/hosts';
import type { FileContent } from '@/lib/protocol';
import { Badge, Icon, Note, Row, SectionTitle, c, useLoad , listStyle } from '@/components/ui';

// The project's instruction files, the ones each agent reads at the start of a
// conversation. Tap to edit; a missing one is created. Your personal ones
// (~/.claude/CLAUDE.md, ~/.codex/AGENTS.md) stay Mac-only: Luther never writes
// into the agents' own folders.
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
  const { cwd } = useLocalSearchParams<{ cwd: string }>();
  const { data, error, loading, load } = useLoad(
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
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={listStyle} contentInsetAdjustmentBehavior="automatic" refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <Stack.Screen options={{ title: 'Instructions' }} />
      {!!error && <Note error>{error}</Note>}
      <SectionTitle>{cwd.split('/').pop() ?? 'Project'}</SectionTitle>
      {FILES.map((f, i) => {
        const lines = data?.[i] ?? 0;
        return (
          <Row
            key={f.path}
            icon={<Icon name={lines ? 'doc.text' : 'doc.badge.plus'} size={20} color={lines ? c.accent : c.faint} />}
            title={f.path}
            sub={`${f.who} · ${f.about}`}
            right={data ? lines ? <Badge label={`${lines} lines`} /> : <Badge label="create" color={c.accent} /> : undefined}
            onPress={() => router.push({ pathname: '/edit', params: { cwd, path: f.path, template: f.path.endsWith('.local.md') ? '' : TEMPLATE } })}
          />
        );
      })}
      <Note>Agents read these when a conversation starts; a running one picks up changes in its next conversation.</Note>
    </ScrollView>
  );
}
