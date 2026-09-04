import type { ClientMessage } from '../shared';

export class SessionsNamespace {
  constructor(private send: (msg: ClientMessage) => void) {}

  create(options?: {
    workspaceId?: string;
    workspaceRootId?: string;
    preconfigId?: string;
    title?: string;
  }): void {
    this.send({ type: 'session.create', ...options });
  }

  resume(sessionId: string): void {
    this.send({ type: 'session.resume', sessionId });
  }

  close(sessionId: string): void {
    this.send({ type: 'session.close', sessionId });
  }

  update(sessionId: string, options?: { preconfigId?: string }): void {
    this.send({ type: 'session.update', sessionId, ...options });
  }

  updateModel(
    sessionId: string,
    options: { modelId: string; providerId: string; variant?: string },
  ): void {
    this.send({ type: 'session.update_model', sessionId, ...options });
  }

  reopen(sessionId: string): void {
    this.send({ type: 'session.reopen', sessionId });
  }

  delete(sessionId: string): void {
    this.send({ type: 'session.delete', sessionId });
  }

  rename(sessionId: string, title: string): void {
    this.send({ type: 'session.rename', sessionId, title });
  }

  compact(sessionId: string): void {
    this.send({ type: 'session.compact', sessionId });
  }

  generateTitle(sessionId: string): void {
    this.send({ type: 'session.generate_title', sessionId });
  }

  revert(sessionId: string, messageId: string): void {
    this.send({ type: 'session.revert', sessionId, messageId });
  }

  fork(sessionId: string, messageId: string, title?: string): void {
    this.send({ type: 'session.fork', sessionId, messageId, title });
  }

  editMessage(sessionId: string, messageId: string, content: string): void {
    this.send({ type: 'session.edit_message', sessionId, messageId, content });
  }

  interrupt(
    sessionId: string,
    reason?: 'user_request' | 'timeout' | 'error',
  ): void {
    this.send({ type: 'session.interrupt', sessionId, reason });
  }
}
