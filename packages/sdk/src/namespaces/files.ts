import type { ClientMessage } from '../shared-protocol/client';

/** Live file tree feed: the server pushes `files.tree` to subscribers when a root's paths change. */
export class FilesNamespace {
  private send: (msg: ClientMessage) => void;

  constructor(send: (msg: ClientMessage) => void) {
    this.send = send;
  }

  subscribeTree(workspaceId: string, root?: string): void {
    this.send({ type: 'files.tree.subscribe', workspaceId, ...(root !== undefined ? { root } : {}) });
  }

  unsubscribeTree(workspaceId: string, root?: string): void {
    this.send({ type: 'files.tree.unsubscribe', workspaceId, ...(root !== undefined ? { root } : {}) });
  }

  refreshTree(workspaceId: string, root?: string): void {
    this.send({ type: 'files.tree.refresh', workspaceId, ...(root !== undefined ? { root } : {}) });
  }
}
