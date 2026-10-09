// Attention feed: what needs the user on a server, pushed over Server-Sent Events.
import { AuthError } from './errors';

export interface AttentionAsk {
  id: string;
  kind: 'approval' | 'question';
  /** Top-level session to open (a subagent's ask surfaces on its root session). */
  sessionId: string;
  sessionTitle: string | null;
  workspaceId: string | null;
  workspaceName: string | null;
  toolName: string;
  createdAt: number;
}

export interface AttentionRunningSession {
  sessionId: string;
  sessionTitle: string | null;
  workspaceId: string;
  workspaceName: string | null;
  runningAt: string;
}

export interface AttentionSnapshot {
  revision: number;
  asks: AttentionAsk[];
  running: AttentionRunningSession[];
}

function attentionUrl(serverUrl: string): string {
  const base = /^https?:\/\//.test(serverUrl) ? serverUrl : `http://${serverUrl}`;
  return `${base.replace(/\/+$/, '')}/api/attention/events`;
}

/**
 * Follows a server's attention stream, calling `onSnapshot` for the current
 * snapshot and every change. Resolves when the server ends the stream, rejects
 * with AuthError when this device is not paired, and with AbortError on abort.
 * Reconnecting is the caller's decision.
 */
export async function followAttention(
  serverUrl: string,
  token: string | undefined,
  onSnapshot: (snapshot: AttentionSnapshot) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(attentionUrl(serverUrl), {
    headers: { Accept: 'text/event-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal,
  });
  if (response.status === 401 || response.status === 403) {
    throw new AuthError('This device is not paired with this server.');
  }
  if (!response.ok || !response.body) throw new Error(`Attention stream failed (HTTP ${response.status})`);

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += value;
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const lines = buffer.slice(0, boundary).split('\n');
        buffer = buffer.slice(boundary + 2);
        if (lines.includes('event: snapshot')) {
          const data = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
          onSnapshot(JSON.parse(data) as AttentionSnapshot);
        }
        boundary = buffer.indexOf('\n\n');
      }
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
}
