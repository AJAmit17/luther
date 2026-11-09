import * as SecureStore from 'expo-secure-store';
import { getRandomBytes } from 'expo-crypto';
import { fetch as xfetch } from 'expo/fetch';
import { File } from 'expo-file-system';
import { box, concat, newKey, nonceId, open, setRandom, sharedKey, text, toB64, fromB64, utf8 } from '@/lib/e2e';

setRandom(getRandomBytes);

// Paired Macs. Each has ordered routes (tailnet, Cloudflare tunnel); requests use
// the first route that answers and fall back when it stops answering.
export type Host = {
  id: string; // device id the Mac gave this phone
  name: string;
  routes: string[];
  token: string;
  cfId?: string; // Cloudflare Access service token (tunnel only)
  cfSecret?: string;
  pub?: string; // the machine's X25519 key (from the QR)
  secret?: string; // this phone's X25519 key for it: set ⇒ everything is end-to-end encrypted
};

const keys = new Map<string, Uint8Array>();
/** The end-to-end key with h, or null for a host paired before encryption. */
export function keyFor(h: Host): Uint8Array | null {
  if (!h.secret || !h.pub) return null;
  let k = keys.get(h.id);
  if (!k) keys.set(h.id, (k = sharedKey(h.secret, h.pub)));
  return k;
}

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

/** Take the current Mac's addresses from it (GET /routes): a Cloudflare quick
 *  tunnel's address changes when it restarts, and this is how the phone learns
 *  the new one while any route still reaches the Mac. */
export async function refreshRoutes() {
  const h = await currentHost();
  if (!h) return;
  const routes = await api<string[]>('/routes').catch(() => null);
  if (!routes?.length || routes.join() === h.routes.join()) return;
  const s = await load();
  s.hosts = s.hosts.map((x) => (x.id === h.id ? { ...x, routes } : x));
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

/** Cloudflare Access headers only (what an encrypted request shows a relay). */
export function cfHeaders(h: Host): Record<string, string> {
  return h.cfId && h.cfSecret ? { 'CF-Access-Client-Id': h.cfId, 'CF-Access-Client-Secret': h.cfSecret } : {};
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

type Init = { method?: string; body?: string | Uint8Array; headers?: Record<string, string> };
type Answer = { status: number; type: string; body: string };

// api: JSON request to the current Mac. A network failure re-picks the route once.
export async function api<T>(path: string, init: Init = {}): Promise<T> {
  const h = await currentHost();
  if (!h) throw new Error('No Mac paired');
  const go = (b: string) => (keyFor(h) ? sealed(h, b, path, init) : plain(h, b, path, init));
  let res: Answer;
  try {
    res = await go(await resolve(h));
  } catch (e) {
    if (e instanceof HttpError) throw e;
    res = await go(await resolve(h, true));
  }
  if (res.status < 200 || res.status >= 300) throw new HttpError(res.body.trim() || `HTTP ${res.status}`, res.status);
  return (res.type.includes('application/json') && res.body ? JSON.parse(res.body) : res.body) as T;
}

async function plain(h: Host, b: string, path: string, init: Init): Promise<Answer> {
  const res = await xfetch(b + path, { method: init.method, body: init.body as any, headers: { 'Content-Type': 'application/json', ...headers(h), ...init.headers } });
  return { status: res.status, type: res.headers.get('Content-Type') ?? '', body: await res.text() };
}

// sealed: the request inside a box to POST /e; only the device id shows.
async function sealed(h: Host, b: string, path: string, init: Init): Promise<Answer> {
  const key = keyFor(h)!;
  const n = nonceId();
  const head = { m: init.method ?? 'GET', p: path, t: Date.now(), n, h: { 'Content-Type': 'application/json', ...init.headers } };
  const body = typeof init.body === 'string' ? utf8(init.body) : init.body ?? new Uint8Array();
  const res = await xfetch(b + '/e', {
    method: 'POST',
    headers: { 'X-Luther-Device': h.id, 'Content-Type': 'application/octet-stream', ...cfHeaders(h) },
    body: box(key, 'req', concat(utf8(JSON.stringify(head) + '\n'), body)),
  });
  if (!res.ok) throw new HttpError((await res.text()).trim() || `HTTP ${res.status}`, res.status);
  const out = open(key, 'res:' + n, new Uint8Array(await res.arrayBuffer()));
  const nl = out.indexOf(10);
  const rh = JSON.parse(text(out.subarray(0, nl))) as { s: number; h?: Record<string, string> };
  return { status: rh.s, type: rh.h?.['Content-Type'] ?? '', body: text(out.subarray(nl + 1)) };
}

export const post = <T>(path: string, body: unknown) => api<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const del = (path: string) => api<string>(path, { method: 'DELETE' });

/** upload: a local file (photo, document) to the Mac; returns its path there, for a send's files. */
export async function upload(uri: string, name: string): Promise<string> {
  const body = await new File(uri).bytes();
  const r = await api<{ path: string }>('/uploads?name=' + encodeURIComponent(name), { method: 'POST', body, headers: { 'Content-Type': 'application/octet-stream' } });
  return r.path;
}

/** A file from the phone into the project at path (refused if one is there, unless replace). */
export async function uploadTo(cwd: string, path: string, uri: string, replace = false): Promise<void> {
  const body = await new File(uri).bytes();
  await api<string>(`/files/upload?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}${replace ? '&replace=1' : ''}`, {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/octet-stream' },
  });
}

// Pairing payload from `luther pair`: {v, name, routes, code, pub}. The code goes
// sealed to pub (which came in the QR, never over the network), so a relay sees
// neither it nor the token that comes back.
export async function pair(payload: string, deviceName: string) {
  let p: { name?: string; routes?: string[]; code?: string; pub?: string };
  try {
    p = JSON.parse(payload.trim());
  } catch {
    throw new Error('Not a Luther pairing code');
  }
  if (!p.code || !p.routes?.length) throw new Error('Not a Luther pairing code (no code or routes). Run `luther pair` on your Mac.');
  if (!p.pub) throw new Error('Update luther on your Mac: this code has no encryption key.');
  const me = newKey();
  const key = sharedKey(me.priv, p.pub);
  const req = JSON.stringify({ pub: me.pub, box: toB64(box(key, 'pair', utf8(JSON.stringify({ code: p.code, name: deviceName, t: Date.now() })))) });
  let last = 'unreachable';
  for (const u of p.routes) {
    try {
      const res = await fetch(u + '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: req });
      const body = await res.text();
      if (!res.ok) throw new Error(body.trim() || `HTTP ${res.status}`);
      const { deviceId, token } = JSON.parse(text(open(key, 'pair-res', fromB64(JSON.parse(body).box))));
      const h: Host = { id: deviceId, name: p.name || 'Mac', routes: p.routes, token, pub: p.pub, secret: me.priv };
      await upsertHost(h);
      return h;
    } catch (e: any) {
      last = e.message;
    }
  }
  throw new Error(`Pairing failed: ${last}`);
}
