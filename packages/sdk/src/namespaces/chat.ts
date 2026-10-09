import type { ClientMessage, ChatMessage, AttachmentKind } from '../shared';

export class ChatNamespace {
  constructor(private _send: (msg: ClientMessage) => void) {}

  send(
    sessionId: string,
    content: string,
    options?: {
      attachments?: Array<{ id: string; kind: AttachmentKind }>;
      responseFormatId?: string;
      goalCondition?: string;
      goalMaxTurns?: number;
      goalTokenBudget?: number;
      clientMessageId?: string;
    },
  ): void {
    const msg: ChatMessage = {
      type: 'chat.message',
      sessionId,
      content,
    };
    if (options?.attachments && options.attachments.length > 0) {
      msg.attachments = options.attachments;
    }
    if (options?.responseFormatId) {
      msg.responseFormatId = options.responseFormatId;
    }
    if (options?.goalCondition) {
      msg.goalCondition = options.goalCondition;
    }
    if (options?.goalMaxTurns !== undefined) msg.goalMaxTurns = options.goalMaxTurns;
    if (options?.goalTokenBudget !== undefined) msg.goalTokenBudget = options.goalTokenBudget;
    if (options?.clientMessageId) msg.clientMessageId = options.clientMessageId;
    this._send(msg);
  }
}
