import type { ClientMessage } from '../shared-protocol/client';

export class ControlNamespace {
  private send: (msg: ClientMessage) => void;

  constructor(send: (msg: ClientMessage) => void) {
    this.send = send;
  }

  claim(sessionId: string): void {
    this.send({
      type: 'session.control.claim',
      sessionId,
    });
  }

  release(sessionId: string): void {
    this.send({
      type: 'session.control.release',
      sessionId,
    });
  }
}
