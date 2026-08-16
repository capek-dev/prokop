export type SessionMessageCommittedEvent =
  | { type: 'message.changed'; messageId: string }
  | { type: 'message.deleted'; messageId: string }
  | { type: 'session.deleted'; sessionId: string };

export interface SessionMessageEventPublisher {
  publish(event: SessionMessageCommittedEvent): void;
}
