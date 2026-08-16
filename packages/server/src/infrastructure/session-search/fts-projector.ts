import type {
  SessionMessageCommittedEvent,
  SessionMessageEventPublisher,
} from '@/application/ports/session-message-events';
import {
  getMessageContentForFts,
  indexMessage,
  removeMessageFromFts,
  removeSessionFromFts,
} from '@/session-search/fts';
import type { Message, Session } from '@jean2/sdk';

export function createFtsProjector(dependencies: {
  getMessage(messageId: string): Message | null;
  getSession(sessionId: string): Session | null;
}): SessionMessageEventPublisher {
  return {
    publish(event: SessionMessageCommittedEvent): void {
      if (event.type === 'message.deleted') {
        removeMessageFromFts(event.messageId);
        return;
      }
      if (event.type === 'session.deleted') {
        removeSessionFromFts(event.sessionId);
        return;
      }

      try {
        const message = dependencies.getMessage(event.messageId);
        if (!message) return;
        const session = dependencies.getSession(message.sessionId);
        if (!session?.workspaceId) return;
        const { content, toolName } = getMessageContentForFts(event.messageId);
        indexMessage(
          event.messageId,
          message.sessionId,
          session.workspaceId,
          message.role,
          content,
          toolName,
          session.agentId,
        );
      } catch {
        // Projection failure must not fail a committed message mutation.
      }
    },
  };
}
