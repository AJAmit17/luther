// Mirror of server/protocol.go — the Go types are the source of truth. Change both together.

/** 'claude', 'codex', or any ACP agent the Mac lists (built-in or from ~/.luther/agents.json). */
export type Provider = string;
export type Mode = 'ask' | 'edits' | 'plan' | 'full';

/** A model as its agent lists it; `resolved` is the full ID an alias runs (Claude). */
export type Model = { id: string; name: string; desc?: string; resolved?: string; group?: string; efforts?: string[]; effort?: string; fast?: boolean };
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

export type OpenReq = { provider: Provider; cwd: string; resume?: string; fork?: boolean; move?: boolean; model?: string; mode?: Mode; worktree?: boolean; template?: string };

/** An agent role (GET /templates): ~/.luther/templates/<name>.md or built in. */
export type Template = { name: string; description: string; provider?: Provider; model?: string; mode?: Mode; instructions: string; builtIn?: boolean };

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
  effort?: string;
  efforts?: string[];
  fast?: 'on' | 'off';
  fastNote?: string;
  commands?: string[];
  usage?: Usage;
  contextTokens?: number;
  tasks?: Task[];
  dup?: boolean;
  goal?: Goal;
};

/** A goal: the thread works toward it turn after turn; a judge checks after each turn. */
export type Goal = { objective: string; rounds: number; round: number; status: 'working' | 'judging' | 'done' | 'blocked' | 'limit' | 'stopped' | 'failed' | 'paused'; note?: string };

export type Task = { text: string; status: 'pending' | 'in_progress' | 'completed' };
export type Turn = { n: number; prompt: string; startedAt: number; endedAt?: number; files: number };

export type ThreadInfo = State & { id: string; title: string; clients: number };

/** role 'artifact': an HTML page the agent showed (text: its title; open with POST /artifacts/{id}/link). */
export type Msg = { id: string; role: 'user' | 'assistant' | 'tool' | 'system' | 'artifact'; text: string; tool?: string; parent?: string /* a subagent call's row id */; images?: string[] /* GET /uploads/{name} */ };
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
  | { type: 'compact' }
  | { type: 'mode'; mode: Mode }
  | { type: 'model'; model: string }
  | { type: 'effort'; effort: string }
  | { type: 'fast'; fast: boolean };

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
// account: set when it isn't the CLI login Luther's agents run under ("Desktop app").
export type Limits = { provider: Provider; account?: string; plan?: string; windows: Window[]; updated: number };
// GET /claude-accounts: names only; active "" = Terminal (the claude CLI's login).
export type ClaudeAccounts = { accounts: string[]; active: string };
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
  runs?: JobRun[]; // newest first, at most 20
};
/** One scheduled run. Runs are unattended: what needed you was declined, and the report says so. */
export type JobRun = { id: string; at: number; manual?: boolean; thread?: string; provider: Provider; session?: string; cwd?: string; status: 'working' | 'finished' | 'failed'; report?: string; ended?: number; read?: boolean };

/** One prompt given to several agents, each in its own worktree. */
export type Compare = { id: string; cwd: string; prompt: string; mode: Mode; created: number; runs: CompareRun[]; kept?: string };
export type CompareRun = {
  provider: Provider;
  model?: string;
  thread?: string;
  session?: string;
  worktree?: string;
  error?: string;
  status?: 'working' | 'waiting' | 'finished' | 'failed' | 'idle' | 'ended';
  reply?: string;
  files: number;
  added: number;
  removed: number;
};
export type Device = { id: string; name: string; created: string; lastSeen: string; encrypted?: boolean };
export type Term = { name: string; cwd: string; attached: boolean; created: number };
export type FileEntry = { name: string; dir: boolean; size: number };
export type FileContent = { path: string; text: string; binary?: boolean; truncated?: boolean; hash?: string };
export type GitChange = { path: string; status: string };
export type GitStatus = { branch: string; upstream?: string; ahead: number; worktree?: boolean; operation?: 'merge' | 'rebase' | 'cherry-pick' | 'revert'; files: GitChange[] };
export type Branches = { current: string; branches: { name: string; upstream?: string; last: number }[]; stashes: { ref: string; message: string; at: number }[] };
export type WorktreeInfo = { path: string; branch: string; files: number; added: number; removed: number };
export type Health = { version: string; started: number; name: string; agents: { id: Provider; name: string; installed: boolean; version?: string; running: boolean; threads: number }[] };
