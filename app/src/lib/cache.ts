import { Directory, File, Paths } from 'expo-file-system';
import { currentHostIdSync } from '@/lib/hosts';

// The last answer to each list request, per Mac, on disk: screens show it at
// once and refresh behind it. ponytail: entries are never pruned; one small file
// per list keeps the set small.
const dir = new Directory(Paths.cache, 'luther-lists');
const memory = new Map<string, unknown>();

const file = (key: string) => {
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) | 0;
  return new File(dir, `${(h >>> 0).toString(16)}.json`);
};
const full = (key: string) => `${currentHostIdSync() ?? '-'}:${key}`;

/** The last kept value for key on the current Mac: this run's, else the one on disk. */
export function peek<T>(key: string): T | undefined {
  const k = full(key);
  if (!memory.has(k)) {
    try {
      const f = file(k);
      if (!f.exists) return undefined;
      const { key: stored, value } = JSON.parse(f.textSync());
      if (stored !== k) return undefined; // hash collision
      memory.set(k, value);
    } catch {
      return undefined;
    }
  }
  return memory.get(k) as T;
}

export function keep(key: string, value: unknown) {
  const k = full(key);
  memory.set(k, value);
  try {
    if (!dir.exists) dir.create({ intermediates: true });
    void file(k).write(JSON.stringify({ key: k, value })).catch(() => {});
  } catch {
    // a cache: losing it is fine
  }
}
