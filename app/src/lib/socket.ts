import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { cfHeaders, currentHost, headers, keyFor, resolve, type Host } from '@/lib/hosts';
import { box, nonceId, open, text, toB64, utf8 } from '@/lib/e2e';
import type { Answer, ClientFrame, Frame, Mode, Msg, Prompt, State } from '@/lib/protocol';

export type Status = 'connecting' | 'open' | 'closed' | 'ended';

// One WebSocket per open screen. Reconnects when the link drops or the app comes
// back to the foreground; each connect starts with a fresh snapshot.
export function useSocket(path: string, onFrame: (f: any) => void, onOpen?: (ws: WebSocket) => void) {
  const [status, setStatus] = useState<Status>('connecting');
  const [error, setError] = useState('');
  const ws = useRef<WebSocket | null>(null);
  const alive = useRef(true);
  const cb = useRef({ onFrame, onOpen, retry: (_ms: number) => {} });
  useEffect(() => {
    cb.current.onFrame = onFrame;
    cb.current.onOpen = onOpen;
  });

  const connect = useCallback(async () => {
    const st = ws.current?.readyState;
    if (!alive.current || st === WebSocket.OPEN || st === WebSocket.CONNECTING) return;
    try {
      const h = await currentHost();
      if (!h) throw new Error('No Mac paired');
      const base = await resolve(h, ws.current !== null); // re-pick the route after a drop
      const sock = openSocket(h, base, path);
      ws.current = sock;
      sock.onopen = () => {
        setStatus('open');
        setError('');
        cb.current.onOpen?.(sock);
      };
      sock.onmessage = (e) => {
        const f = JSON.parse(String(e.data));
        if (f.type === 'error') setError(f.error);
        else if (f.type === 'ended') setStatus('ended');
        else cb.current.onFrame(f);
      };
      sock.onclose = () => {
        setStatus((s) => (s === 'ended' ? s : 'closed'));
        if (alive.current && AppState.currentState === 'active') cb.current.retry(2000);
      };
    } catch (e: any) {
      setStatus('closed');
      setError(e.message);
      if (alive.current) cb.current.retry(4000);
    }
  }, [path]);

  useEffect(() => {
    alive.current = true;
    cb.current.retry = (ms) => setTimeout(connect, ms);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- connect only sets state after an await
    connect();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && connect());
    return () => {
      alive.current = false;
      sub.remove();
      ws.current?.close();
    };
  }, [connect]);

  const send = useCallback((m: object) => {
    if (ws.current?.readyState !== WebSocket.OPEN) {
      setError('Not connected yet, try again');
      return false;
    }
    ws.current.send(JSON.stringify(m));
    return true;
  }, []);

  return { status, error, setError, send, ws };
}

// A conversation with one agent: the thread hub's stream.
export function useThread(id: string) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [state, setState] = useState<State | null>(null);
  const [prompts, setPrompts] = useState<Prompt[]>([]);

  const sock = useSocket(`/threads/${encodeURIComponent(id)}/events`, (f: Frame) => {
    switch (f.type) {
      case 'snapshot':
        setMessages(f.messages);
        setDraft(f.draft);
        setState(f.state);
        setPrompts(f.prompts);
        break;
      case 'message':
        setMessages((m) => [...m, f.message]);
        if (f.message.role === 'assistant') setDraft(''); // the committed text replaces the draft
        break;
      case 'messages':
        setMessages((m) => (f.reset ? f.messages : [...m, ...f.messages]));
        break;
      case 'draft':
        setDraft((d) => (f.reset ? '' : d + (f.delta ?? '')));
        break;
      case 'state':
        setState(f.state);
        if (!f.state.busy) setDraft('');
        break;
      case 'prompt':
        setPrompts((p) => [...p.filter((x) => x.id !== f.prompt.id), f.prompt]);
        break;
      case 'prompt_closed':
        setPrompts((p) => p.filter((x) => x.id !== f.id));
        break;
    }
  });
  const send = (m: ClientFrame) => sock.send(m);

  return {
    ...sock,
    messages,
    draft,
    state,
    prompts,
    sendText: (text: string, files?: string[]) => send({ type: 'send', text, files }),
    answer: (a: Partial<Answer> & { id: string }) => send({ type: 'answer', choice: -1, ...a }),
    interrupt: () => send({ type: 'interrupt' }),
    setMode: (mode: Mode) => send({ type: 'mode', mode }),
    setModel: (model: string) => send({ type: 'model', model }),
  };
}

// A terminal: rendered ANSI screen out, raw bytes in.
export function useTerm(name: string) {
  const [screen, setScreen] = useState('');
  const size = useRef<object | null>(null);
  const sock = useSocket(
    `/terms/${encodeURIComponent(name)}/events`,
    (f) => f.type === 'screen' && setScreen(f.ansi),
    (ws) => size.current && ws.send(JSON.stringify(size.current)), // re-announce after reconnects
  );
  return {
    ...sock,
    screen,
    input: (s: string) => sock.send({ type: 'input', hex: toHex(s) }),
    resize: (cols: number, rows: number) => {
      size.current = { type: 'size', cols, rows };
      if (sock.ws.current?.readyState === WebSocket.OPEN) sock.ws.current.send(JSON.stringify(size.current));
    },
  };
}

export const toHex = (s: string) => Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, '0')).join('');

/** A socket to path on h: plain (React Native's WebSocket takes the token and
 *  Cloudflare Access headers), or end-to-end encrypted through /e/ws — the same
 *  surface either way, text frames in and out. */
function openSocket(h: Host, base: string, path: string): WebSocket {
  const ws = base.replace(/^http/, 'ws');
  const key = keyFor(h);
  if (!key) return new (WebSocket as any)(ws + path, undefined, { headers: headers(h) }) as WebSocket;
  const n = nonceId();
  const opener = toB64(box(key, 'ws-open', utf8(JSON.stringify({ p: path, t: Date.now(), n }))), true);
  const raw = new (WebSocket as any)(`${ws}/e/ws?d=${encodeURIComponent(h.id)}&b=${opener}`, undefined, { headers: cfHeaders(h) }) as WebSocket;
  raw.binaryType = 'arraybuffer';
  let out = 0;
  let inn = 0;
  const wrapped = {
    get readyState() {
      return raw.readyState;
    },
    send(data: string) {
      raw.send(box(key, `ws>:${n}:${out++}`, utf8(data)));
    },
    close: () => raw.close(),
    set onopen(fn: any) {
      raw.onopen = fn;
    },
    set onclose(fn: any) {
      raw.onclose = fn;
    },
    set onerror(fn: any) {
      raw.onerror = fn;
    },
    set onmessage(fn: any) {
      raw.onmessage = (e) => {
        let data: string;
        try {
          data = text(open(key, `ws<:${n}:${inn++}`, new Uint8Array(e.data as ArrayBuffer)));
        } catch {
          raw.close(); // out of step or tampered: reconnect fresh
          return;
        }
        fn({ data });
      };
    },
  };
  return wrapped as unknown as WebSocket;
}
