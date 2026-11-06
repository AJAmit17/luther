// Mirror of server/protocol.go — the Go types are the source of truth. Change both together.

export type Provider = 'claude' | 'codex' | 'opencode' | 'gemini' | 'cursor' | 'devin'; // the last three speak ACP
export type Mode = 'ask' | 'edits' | 'plan' | 'full';

export type ProviderInfo = { id: Provider; name: string; installed: boolean; version?: string; modes: Mode[] };

export type Project = { cwd: string; name: string; sessions: number; lastActive: string; live: number };

export type Session = {
  provider: Provider;
  id: string;
  cwd: string;
  title: string;
  preview: string;
  lastActive: string;
  live: string;
  busy: boolean;
  pinned?: boolean;
  archived?: boolean;
  worktree?: string; // branch, when it ran in a Luther worktree of this project
};

export type OpenReq = { provider: Provider; cwd: string; resume?: string; fork?: boolean; move?: boolean; model?: string; mode?: Mode; worktree?: boolean };

export type Usage = { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number; costUsd?: number; costReported?: boolean };
export type UsageDay = Usage & { date: string };
export type UsageBreakdown = Usage & { provider: Provider; model?: string };
export type UsageHistory = { days: UsageDay[]; total: Usage; breakdown: UsageBreakdown[]; updated: number; notes: string[] };
export type Repository = { cwd: string; name: string; branch: string; changes: number; error?: string };

export type State = {
  provider: Provider;
  session: string;
  cwd: string;
  busy: boolean;
  activity: string;
  model: string;
  mode: Mode;
  commands?: string[];
  usage?: Usage;
  contextTokens?: number;
  tasks?: Task[];
  dup?: boolean;
};

export type Task = { text: string; status: 'pending' | 'in_progress' | 'completed' };
export type Turn = { n: number; prompt: string; startedAt: number; endedAt?: number; files: number };

export type ThreadInfo = State & { id: string; title: string; clients: number };

export type Msg = { id: string; role: 'user' | 'assistant' | 'tool' | 'system'; text: string; tool?: string; parent?: string /* a subagent call's row id */; images?: string[] /* GET /uploads/{name} */ };
export type Option = { label: string; desc?: string };
export type Question = { id: string; question: string; header?: string; options: Option[]; multiSelect?: boolean };
export type Prompt = {
  id: string;
  kind: 'permission' | 'question' | 'plan';
  tool: string;
  title: string;
  body?: string;
  options?: Option[];
  questions?: Question[];
};
export type Answer = { id: string; choice: number; answers?: Record<string, string[]>; message?: string };

export type Frame =
  | { type: 'snapshot'; state: State; messages: Msg[]; draft: string; prompts: Prompt[] }
  | { type: 'message'; message: Msg }
  | { type: 'messages'; messages: Msg[]; reset?: boolean }
  | { type: 'draft'; delta?: string; reset?: boolean }
  | { type: 'state'; state: State }
  | { type: 'prompt'; prompt: Prompt }
  | { type: 'prompt_closed'; id: string }
  | { type: 'error'; error: string }
  | { type: 'ended' };

export type ClientFrame =
  | { type: 'send'; text: string; files?: string[] }
  | ({ type: 'answer' } & Answer)
  | { type: 'interrupt' }
  | { type: 'mode'; mode: Mode }
  | { type: 'model'; model: string };

export type Run = {
  thread: string;
  session: string;
  provider: Provider;
  cwd: string;
  title: string;
  phase: 'working' | 'waiting' | 'finished' | 'failed';
  detail: string;
  startedAt: number;
  endedAt?: number;
  prompt?: string; // waiting on this prompt id
  kind?: Prompt['kind'];
  done?: number;
  total?: number;
};

export type Command = { name: string; desc: string };
export type Limits = { provider: Provider; plan?: string; windows: Window[]; updated: number };
export type Window = { label: string; used: number /* percent */; resetsAt?: number };
export type Port = { port: number; command: string; cwd?: string };
export type Job = {
  id: string;
  name: string;
  cron: string;
  enabled: boolean;
  provider: Provider;
  cwd: string;
  prompt: string;
  mode?: Mode;
  model?: string;
  worktree?: boolean;
  next?: number;
  lastRun?: number;
  lastThread?: string;
  lastError?: string;
};
export type Device = { id: string; name: string; created: string; lastSeen: string; encrypted?: boolean };
export type Term = { name: string; cwd: string; attached: boolean; created: number };
export type FileEntry = { name: string; dir: boolean; size: number };
export type FileContent = { path: string; text: string; binary?: boolean; truncated?: boolean; hash?: string };
export type GitChange = { path: string; status: string };
export type GitStatus = { branch: string; upstream?: string; ahead: number; worktree?: boolean; files: GitChange[] };
