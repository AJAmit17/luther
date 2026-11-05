/** Schedules as people say them, and back. Presets cover what most jobs need;
 *  anything else is shown as its cron expression. No React Native imports. */

export type Preset = 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'custom';
export const DAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];

const pad = (n: number) => String(n).padStart(2, '0');

/** The cron for a preset at hh:mm (weekly: on day 0–6). */
export function toCron(p: Exclude<Preset, 'custom'>, time = '09:00', day = 1): string {
  const [h, m] = parseTime(time) ?? [9, 0];
  switch (p) {
    case 'hourly':
      return `${m} * * * *`;
    case 'daily':
      return `${m} ${h} * * *`;
    case 'weekdays':
      return `${m} ${h} * * 1-5`;
    case 'weekly':
      return `${m} ${h} * * ${day}`;
  }
}

export function parseTime(t: string): [number, number] | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return null;
  const h = +m[1], min = +m[2]; // prettier-ignore
  return h < 24 && min < 60 ? [h, min] : null;
}

/** What a cron expression is, as a preset (with its time and day) when it is one. */
export function fromCron(c: string): { preset: Preset; time: string; day: number } {
  const f = c.trim().split(/\s+/);
  const plain = (s: string) => /^\d+$/.test(s);
  if (f.length === 5 && plain(f[0]) && f[2] === '*' && f[3] === '*') {
    const time = plain(f[1]) ? `${pad(+f[1])}:${pad(+f[0])}` : '09:00';
    if (f[1] === '*' && f[4] === '*') return { preset: 'hourly', time: `00:${pad(+f[0])}`, day: 1 };
    if (plain(f[1]) && f[4] === '*') return { preset: 'daily', time, day: 1 };
    if (plain(f[1]) && f[4] === '1-5') return { preset: 'weekdays', time, day: 1 };
    if (plain(f[1]) && /^[0-7]$/.test(f[4])) return { preset: 'weekly', time, day: +f[4] % 7 };
  }
  return { preset: 'custom', time: '09:00', day: 1 };
}

export function describe(c: string): string {
  const { preset, time, day } = fromCron(c);
  const [h, m] = parseTime(time) ?? [0, 0];
  switch (preset) {
    case 'hourly':
      return m ? `Every hour at :${pad(m)}` : 'Every hour';
    case 'daily':
      return `Every day at ${h}:${pad(m)}`;
    case 'weekdays':
      return `Weekdays at ${h}:${pad(m)}`;
    case 'weekly':
      return `${DAYS[day]} at ${h}:${pad(m)}`;
  }
  const macro: Record<string, string> = { '@hourly': 'Every hour', '@daily': 'Every day at 9:00', '@weekdays': 'Weekdays at 9:00', '@weekly': 'Mondays at 9:00' };
  return macro[c.trim()] ?? `cron: ${c.trim()}`;
}
