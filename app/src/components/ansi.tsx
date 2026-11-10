import { Span, Text, palettes } from '@/design';

// Renders `tmux capture-pane -e` output (SGR escapes) as native Text spans.
// The terminal is always dark; the palette has no magenta or cyan, so those borrow accent and blue.
const t = palettes.dark;
const BASE = [t.muted, t.red, t.green, t.warn, t.blue, t.accent, t.blue, t.text];
const BRIGHT = [t.faint, t.red, t.green, t.warn, t.blue, t.accent, t.blue, t.text];

function xterm256(n: number) {
  if (n < 8) return BASE[n];
  if (n < 16) return BRIGHT[n - 8];
  if (n >= 232) {
    const v = 8 + (n - 232) * 10;
    return `rgb(${v},${v},${v})`;
  }
  n -= 16;
  const s = [0, 95, 135, 175, 215, 255];
  return `rgb(${s[Math.floor(n / 36)]},${s[Math.floor(n / 6) % 6]},${s[n % 6]})`;
}

type Style = { color?: string; backgroundColor?: string; fontWeight?: 'bold'; opacity?: number; textDecorationLine?: 'underline' };

function apply(st: Style, codes: number[]): Style {
  st = { ...st };
  for (let i = 0; i < codes.length; i++) {
    const n = codes[i];
    if (n === 0) st = {};
    else if (n === 1) st.fontWeight = 'bold';
    else if (n === 2) st.opacity = 0.6;
    else if (n === 4) st.textDecorationLine = 'underline';
    else if (n === 22) { delete st.fontWeight; delete st.opacity; }
    else if (n === 24) delete st.textDecorationLine;
    else if (n >= 30 && n <= 37) st.color = BASE[n - 30];
    else if (n >= 90 && n <= 97) st.color = BRIGHT[n - 90];
    else if (n === 39) delete st.color;
    else if (n >= 40 && n <= 47) st.backgroundColor = BASE[n - 40];
    else if (n >= 100 && n <= 107) st.backgroundColor = BRIGHT[n - 100];
    else if (n === 49) delete st.backgroundColor;
    else if ((n === 38 || n === 48) && codes[i + 1] === 5) {
      st[n === 38 ? 'color' : 'backgroundColor'] = xterm256(codes[i + 2]);
      i += 2;
    } else if ((n === 38 || n === 48) && codes[i + 1] === 2) {
      st[n === 38 ? 'color' : 'backgroundColor'] = `rgb(${codes[i + 2]},${codes[i + 3]},${codes[i + 4]})`;
      i += 4;
    }
  }
  return st;
}

export function AnsiText({ text, fontSize = 11 }: { text: string; fontSize?: number }) {
  const spans: { t: string; s: Style }[] = [];
  let st: Style = {};
  const re = /\x1b\[([\d;]*)m/g;
  let last = 0;
  for (let m; (m = re.exec(text)); ) {
    if (m.index > last) spans.push({ t: text.slice(last, m.index), s: st });
    st = apply(st, m[1] ? m[1].split(';').map(Number) : [0]);
    last = re.lastIndex;
  }
  spans.push({ t: text.slice(last).replace(/\x1b\[[\d;?]*[A-Za-z]/g, ''), s: st });
  return (
    <Text selectable mono style={{ fontSize, lineHeight: fontSize * 1.3, color: t.text }}>
      {spans.map((x, i) => (
        <Span key={i} mono style={x.s}>{x.t}</Span>
      ))}
    </Text>
  );
}
