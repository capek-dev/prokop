import type { ServerWebSocket } from 'bun';

type TerminalSocket = ServerWebSocket<unknown>;
import type { TerminalEvent, TerminalSessionInfo } from '@prokopai/sdk';

export class TerminalEventManager {
  private listeners = new Map<string, Set<TerminalSocket>>();

  subscribe(workspaceId: string, ws: TerminalSocket): TerminalEvent {
    let set = this.listeners.get(workspaceId);
    if (!set) {
      set = new Set();
      this.listeners.set(workspaceId, set);
    }
    set.add(ws);
    return { type: 'snapshot', sessions: [] };
  }

  unsubscribe(workspaceId: string, ws: TerminalSocket): void {
    const set = this.listeners.get(workspaceId);
    if (set) {
      set.delete(ws);
      if (set.size === 0) {
        this.listeners.delete(workspaceId);
      }
    }
  }

  broadcast(workspaceId: string, event: TerminalEvent): void {
    const set = this.listeners.get(workspaceId);
    if (!set || set.size === 0) return;
    const payload = JSON.stringify(event);
    const dead: TerminalSocket[] = [];
    for (const ws of set) {
      try {
        ws.send(payload);
      } catch {
        dead.push(ws);
      }
    }
    for (const ws of dead) {
      set.delete(ws);
    }
  }

  broadcastSessionInfo(workspaceId: string, info: TerminalSessionInfo, eventType: 'created' | 'exited' | 'title_changed' | 'status_changed'): void {
    let event: TerminalEvent;
    switch (eventType) {
      case 'created':
        event = { type: 'created', session: info };
        break;
      case 'exited':
        event = { type: 'exited', sessionId: info.id, exitCode: info.exitCode ?? 0 };
        break;
      case 'title_changed':
        event = { type: 'title_changed', sessionId: info.id, title: info.title };
        break;
      case 'status_changed':
        event = { type: 'status_changed', sessionId: info.id, status: info.status };
        break;
    }
    this.broadcast(workspaceId, event);
  }

  broadcastDestroyed(workspaceId: string, sessionId: string): void {
    this.broadcast(workspaceId, { type: 'destroyed', sessionId });
  }
}