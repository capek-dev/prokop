import type { ClientMessage } from '../shared-protocol/client';

/** Live Git status feed: the server pushes `git.status` to subscribers when a root's status changes. */
export class GitNamespace {
  private send: (msg: ClientMessage) => void;

  constructor(send: (msg: ClientMessage) => void) {
    this.send = send;
  }

  subscribeStatus(workspaceId: string, root?: string): void {
    this.send({ type: 'git.status.subscribe', workspaceId, ...(root !== undefined ? { root } : {}) });
  }

  unsubscribeStatus(workspaceId: string, root?: string): void {
    this.send({ type: 'git.status.unsubscribe', workspaceId, ...(root !== undefined ? { root } : {}) });
  }

  refreshStatus(workspaceId: string, root?: string): void {
    this.send({ type: 'git.status.refresh', workspaceId, ...(root !== undefined ? { root } : {}) });
  }
}
