import { x25519 } from '@noble/curves/ed25519.js';
import { gcm } from '@noble/ciphers/aes.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

/* End-to-end encryption with a paired machine, so a relay (Cloudflare) sees only
 * ciphertext. Mirrors server/internal/seal (keep them in step; e2e.test.ts pins
 * the shared vector):
 *   key = HKDF-SHA256(X25519(phone, server), salt "luther-e2e-v1", info serverPub ‖ phonePub)
 *   box = nonce(12) ‖ AES-256-GCM(key, nonce, plain, aad)
 * No React Native imports here: node --test runs it. */

let random = (n: number): Uint8Array => globalThis.crypto.getRandomValues(new Uint8Array(n));
/** The app plugs in expo-crypto (Hermes has no crypto.getRandomValues). */
export function setRandom(fn: (n: number) => Uint8Array) {
  random = fn;
}

const enc = new TextEncoder();
const dec = new TextDecoder();
export const utf8 = (s: string) => enc.encode(s);
export const text = (b: Uint8Array) => dec.decode(b);

export function concat(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function toB64(b: Uint8Array, url = false) {
  let s = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < b.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < b.length ? B64[n & 63] : '=');
  }
  return url ? s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : s;
}
export function fromB64(s: string) {
  s = s.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let bits = 0, acc = 0, j = 0; // prettier-ignore
  for (const ch of s) {
    const v = B64.indexOf(ch);
    if (v < 0) throw new Error('bad base64');
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[j++] = (acc >> bits) & 255;
    }
  }
  return out;
}

/** A fresh X25519 key pair, base64. */
export function newKey() {
  const priv = random(32);
  return { priv: toB64(priv), pub: toB64(x25519.getPublicKey(priv)) };
}

export const publicOf = (priv: string) => toB64(x25519.getPublicKey(fromB64(priv)));

/** The channel key, from the phone's side. */
export function sharedKey(phonePriv: string, serverPub: string) {
  const priv = fromB64(phonePriv);
  const sp = fromB64(serverPub);
  const secret = x25519.getSharedSecret(priv, sp);
  return hkdf(sha256, secret, utf8('luther-e2e-v1'), concat(sp, x25519.getPublicKey(priv)), 32);
}

export function box(key: Uint8Array, aad: string, plain: Uint8Array, nonce = random(12)) {
  return concat(nonce, gcm(key, nonce, utf8(aad)).encrypt(plain));
}

export function open(key: Uint8Array, aad: string, b: Uint8Array) {
  if (b.length < 28) throw new Error("Can't decrypt the Mac's answer");
  try {
    return gcm(key, b.subarray(0, 12), utf8(aad)).decrypt(b.subarray(12));
  } catch {
    throw new Error("Can't decrypt the Mac's answer (pair this phone again?)");
  }
}

/** A random id for a request or socket (replay protection). */
export const nonceId = () => toB64(random(12), true);
