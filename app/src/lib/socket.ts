import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { currentHost, headers, resolve } from '@/lib/hosts';
import type { Answer, ClientFrame, Frame, Mode, Msg, Prompt, State } from '@/lib/protocol';

export type Status = 'connecting' | 'open' | 'closed' | 'ended';

// One WebSocket per open screen. Reconnects when the link drops or the app comes
// back to the foreground; each connect starts with a fresh snapshot.
function useSocket(path: string, onFrame: (f: any) => void, onOpen?: (ws: WebSocket) => void) {
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
      // React Native's WebSocket takes headers (token + Cloudflare Access).
      const sock = new (WebSocket as any)(base.replace(/^http/, 'ws') + path, undefined, { headers: headers(h) }) as WebSocket;
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
    sendText: (text: string) => send({ type: 'send', text }),
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
