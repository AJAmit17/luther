/** A small syntax highlighter for the file viewer: comments, strings,
 *  keywords and numbers, by file extension. Not a parser: good enough to read
 *  code on a phone. No React Native imports: node --test runs it. */

export type Kind = 'plain' | 'comment' | 'string' | 'keyword' | 'number';
export type Span = { text: string; kind: Kind };

type Lang = { line?: string[]; block?: [string, string]; quotes: string[]; keywords: Set<string> };

const words = (s: string) => new Set(s.split(' '));
const cLike = 'if else for while do switch case default break continue return function const let var class new this super extends implements import export from as async await try catch finally throw typeof instanceof in of interface type enum public private protected static readonly void null undefined true false package func go defer chan map struct range select fallthrough goto nil fn let mut impl trait pub use mod match loop where self Self crate dyn move ref unsafe extern int long short char float double bool boolean string byte rune uint def val guard protocol extension override final lazy weak inout throws rethrows';
const LANGS: Record<string, Lang> = {
  c: { line: ['//'], block: ['/*', '*/'], quotes: ['"', "'", '`'], keywords: words(cLike) },
  hash: { line: ['#'], quotes: ['"', "'", '`'], keywords: words('if then else elif fi for while do done case esac function return in local export def class import from as with try except finally raise pass lambda yield None True False and or not is self async await print begin end module require unless until puts nil') },
  sql: { line: ['--'], block: ['/*', '*/'], quotes: ["'", '"'], keywords: words('select from where insert into values update set delete create table index view drop alter add join left right inner outer on group by order having limit offset as and or not null is in exists union all distinct primary key foreign references default case when then else end SELECT FROM WHERE INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE INDEX DROP ALTER JOIN LEFT INNER ON GROUP BY ORDER HAVING LIMIT AS AND OR NOT NULL IS IN UNION ALL DISTINCT PRIMARY KEY DEFAULT CASE WHEN THEN ELSE END') },
  data: { line: ['#'], quotes: ['"', "'"], keywords: words('true false null yes no on off') },
  json: { quotes: ['"'], keywords: words('true false null') },
  css: { block: ['/*', '*/'], quotes: ['"', "'"], keywords: words('important media import from to and not only screen') },
};
const BY_EXT: Record<string, string> = {
  js: 'c', jsx: 'c', ts: 'c', tsx: 'c', mjs: 'c', cjs: 'c', go: 'c', rs: 'c', java: 'c', kt: 'c', kts: 'c', swift: 'c', c: 'c', h: 'c', cc: 'c', cpp: 'c', hpp: 'c', m: 'c', mm: 'c', cs: 'c', dart: 'c', scala: 'c', php: 'c', zig: 'c',
  py: 'hash', rb: 'hash', sh: 'hash', bash: 'hash', zsh: 'hash', fish: 'hash', pl: 'hash', r: 'hash', toml: 'data', yaml: 'data', yml: 'data', ini: 'data', conf: 'data', env: 'data', dockerfile: 'hash', makefile: 'hash', mk: 'hash',
  sql: 'sql', json: 'json', jsonc: 'c', css: 'css', scss: 'c', less: 'c',
};

/** The highlighter for a file name, or null to show it plain. */
export function langOf(name: string): Lang | null {
  const base = name.split('/').pop()!.toLowerCase();
  const ext = base.includes('.') ? base.split('.').pop()! : base;
  const id = BY_EXT[ext];
  return id ? LANGS[id] : null;
}

/** Spans for text in lang; adjacent plain text is merged. */
export function highlight(text: string, lang: Lang): Span[] {
  const out: Span[] = [];
  const push = (t: string, kind: Kind) => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last && last.kind === kind && kind === 'plain') last.text += t;
    else out.push({ text: t, kind });
  };
  let i = 0;
  const n = text.length;
  while (i < n) {
    const rest = (s: string) => text.startsWith(s, i);
    const line = lang.line?.find(rest);
    if (line) {
      const end = text.indexOf('\n', i);
      const j = end < 0 ? n : end;
      push(text.slice(i, j), 'comment');
      i = j;
      continue;
    }
    if (lang.block && rest(lang.block[0])) {
      const end = text.indexOf(lang.block[1], i + lang.block[0].length);
      const j = end < 0 ? n : end + lang.block[1].length;
      push(text.slice(i, j), 'comment');
      i = j;
      continue;
    }
    const ch = text[i];
    if (lang.quotes.includes(ch)) {
      let j = i + 1;
      while (j < n && text[j] !== ch && (ch === '`' || text[j] !== '\n')) j += text[j] === '\\' ? 2 : 1;
      j = Math.min(n, j + 1);
      push(text.slice(i, j), 'string');
      i = j;
      continue;
    }
    if (/[0-9]/.test(ch) && !/[A-Za-z0-9_$]/.test(text[i - 1] ?? '')) {
      const m = /^(0x[0-9a-fA-F_]+|[0-9][0-9_]*(\.[0-9_]+)?([eE][+-]?[0-9]+)?)/.exec(text.slice(i, i + 40));
      const t = m ? m[0] : ch;
      push(t, 'number');
      i += t.length;
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_$]/.test(text[j])) j++;
      const w = text.slice(i, j);
      push(w, lang.keywords.has(w) ? 'keyword' : 'plain');
      i = j;
      continue;
    }
    push(ch, 'plain');
    i++;
  }
  return out;
}
