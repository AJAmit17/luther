import * as SecureStore from 'expo-secure-store';

// Paired Macs. Each has ordered routes (tailnet, Cloudflare tunnel); requests use
// the first route that answers and fall back when it stops answering.
export type Host = {
  id: string; // device id the Mac gave this phone
  name: string;
  routes: string[];
  token: string;
  cfId?: string; // Cloudflare Access service token (tunnel only)
  cfSecret?: string;
};

type Store = { hosts: Host[]; current: string | null };

const KEY = 'luther.hosts';
let store: Store | null = null;
const base = new Map<string, string>(); // host id → route in use

async function load(): Promise<Store> {
  if (!store) {
    const s = await SecureStore.getItemAsync(KEY);
    store = s ? JSON.parse(s) : { hosts: [], current: null };
  }
  return store!;
}

const listeners = new Set<() => void>();
/** Called after the current Mac (or the list) changes. */
export function onHostsChange(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

async function save() {
  await SecureStore.setItemAsync(KEY, JSON.stringify(store));
  listeners.forEach((fn) => fn());
}

/** The current Mac's id, once the store has loaded (for cache keys); else null. */
export function currentHostIdSync(): string | null {
  return store ? (store.hosts.find((h) => h.id === store!.current) ?? store.hosts[0])?.id ?? null : null;
}

export async function hosts() {
  return (await load()).hosts;
}

export async function currentHost(): Promise<Host | null> {
  const s = await load();
  return s.hosts.find((h) => h.id === s.current) ?? s.hosts[0] ?? null;
}

export async function setCurrent(id: string) {
  (await load()).current = id;
  await save();
}

export async function upsertHost(h: Host) {
  const s = await load();
  s.hosts = [...s.hosts.filter((x) => x.id !== h.id), h];
  s.current = h.id;
  base.delete(h.id);
  await save();
}

export async function removeHost(id: string) {
  const s = await load();
  s.hosts = s.hosts.filter((h) => h.id !== id);
  if (s.current === id) s.current = s.hosts[0]?.id ?? null;
  base.delete(id);
  await save();
}

export function headers(h: Host): Record<string, string> {
  const x: Record<string, string> = { Authorization: `Bearer ${h.token}` };
  if (h.cfId && h.cfSecret) {
    x['CF-Access-Client-Id'] = h.cfId;
    x['CF-Access-Client-Secret'] = h.cfSecret;
  }
  return x;
}

async function probe(url: string, h: Pick<Host, 'cfId' | 'cfSecret'>, ms = 2500): Promise<boolean> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const cf: Record<string, string> = h.cfId && h.cfSecret ? { 'CF-Access-Client-Id': h.cfId, 'CF-Access-Client-Secret': h.cfSecret } : {};
    return (await fetch(url + '/healthz', { headers: cf, signal: ctl.signal })).ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

// resolve: the first route (in the host's order) that answers; cached until force.
export async function resolve(h: Host, force = false): Promise<string> {
  const cached = base.get(h.id);
  if (cached && !force) return cached;
  for (const u of h.routes) {
    if (await probe(u, h)) {
      base.set(h.id, u);
      return u;
    }
  }
  base.delete(h.id);
  throw new Error(`${h.name} is unreachable on every route. Is Tailscale on, or the tunnel running?`);
}

export function routeInUse(h: Host | null) {
  return h ? base.get(h.id) ?? null : null;
}

export class HttpError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

// api: JSON request to the current Mac. A network failure re-picks the route once.
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const h = await currentHost();
  if (!h) throw new Error('No Mac paired');
  const go = async (b: string) => fetch(b + path, { ...init, headers: { 'Content-Type': 'application/json', ...headers(h), ...(init.headers as Record<string, string>) } });
  let res: Response;
  try {
    res = await go(await resolve(h));
  } catch {
    res = await go(await resolve(h, true));
  }
  const text = await res.text();
  if (!res.ok) throw new HttpError(text.trim() || `HTTP ${res.status}`, res.status);
  const type = res.headers.get('Content-Type') ?? '';
  return (type.includes('application/json') && text ? JSON.parse(text) : text) as T;
}

export const post = <T>(path: string, body: unknown) => api<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const del = (path: string) => api<string>(path, { method: 'DELETE' });

/** upload: a local file (photo, document) to the Mac; returns its path there, for a send's files. */
export async function upload(uri: string, name: string): Promise<string> {
  const body = await (await fetch(uri)).blob();
  const r = await api<{ path: string }>('/uploads?name=' + encodeURIComponent(name), { method: 'POST', body, headers: { 'Content-Type': 'application/octet-stream' } });
  return r.path;
}

// Pairing payload from `luther pair`: {v, name, routes, code}.
export async function pair(text: string, deviceName: string) {
  let p: { name?: string; routes?: string[]; code?: string };
  try {
    p = JSON.parse(text.trim());
  } catch {
    throw new Error('Not a Luther pairing code');
  }
  if (!p.code || !p.routes?.length) throw new Error('Not a Luther pairing code (no code or routes). Run `luther pair` on your Mac.');
  let last = 'unreachable';
  for (const u of p.routes) {
    try {
      const res = await fetch(u + '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: p.code, name: deviceName }) });
      const body = await res.text();
      if (!res.ok) throw new Error(body.trim() || `HTTP ${res.status}`);
      const { deviceId, token } = JSON.parse(body);
      const h: Host = { id: deviceId, name: p.name || 'Mac', routes: p.routes, token };
      await upsertHost(h);
      return h;
    } catch (e: any) {
      last = e.message;
    }
  }
  throw new Error(`Pairing failed: ${last}`);
}
