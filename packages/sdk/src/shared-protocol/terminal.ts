export interface TerminalSessionInfo {
  id: string;
  pid: number;
  shell: string;
  cwd: string;
  cols: number;
  rows: number;
  title: string;
  status: 'running' | 'exited';
  exitCode: number | null;
  createdAt: number;
  lastActivityAt: number;
  activeClientCount: number;
  inAlternateScreen: boolean;
  /** Who created the session. 'user' terminals come from the terminal
   * panel; 'agent' terminals were spawned by the terminal tool. Omitted
   * by older servers, treat as 'user'. */
  origin?: 'user' | 'agent';
}

export interface TerminalSessionInit {
  sessionId: string;
  pid: number;
  shell: string;
  cwd: string;
  cols: number;
  rows: number;
  status: 'running' | 'exited';
  exitCode: number | null;
  isReconnect: boolean;
  title: string;
  createdAt: number;
  inAlternateScreen?: boolean;
}

export interface TerminalListResponse {
  sessions: TerminalSessionInfo[];
}

export type TerminalEvent =
  | { type: 'snapshot'; sessions: TerminalSessionInfo[] }
  | { type: 'created'; session: TerminalSessionInfo }
  | { type: 'destroyed'; sessionId: string }
  | { type: 'exited'; sessionId: string; exitCode: number }
  | { type: 'title_changed'; sessionId: string; title: string }
  | { type: 'status_changed'; sessionId: string; status: 'running' | 'exited' };
