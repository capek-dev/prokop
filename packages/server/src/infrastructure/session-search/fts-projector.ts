import type {
  SessionMessageCommittedEvent,
  SessionMessageEventPublisher,
} from '@/application/ports/session-message-events';
import {
  getMessageContentForFts,
} from '@/infrastructure/sqlite/session-search-query-repository';
import {
  indexMessage,
  removeMessageFromFts,
  removeSessionFromFts,
  type FtsDatabase,
} from './fts';
import type { Message, Session } from '@jean2/sdk';

export function createFtsProjector(dependencies: {
  getDatabase(): FtsDatabase;
  getMessage(messageId: string): Message | null;
  getSession(sessionId: string): Session | null;
}): SessionMessageEventPublisher {
  return {
    publish(event: SessionMessageCommittedEvent): void {
      const db = dependencies.getDatabase();
      if (event.type === 'message.deleted') {
        removeMessageFromFts(db, event.messageId);
        return;
      }
      if (event.type === 'session.deleted') {
        removeSessionFromFts(db, event.sessionId);
        return;
      }

      try {
        const message = dependencies.getMessage(event.messageId);
        if (!message) return;
        const session = dependencies.getSession(message.sessionId);
        if (!session?.workspaceId) return;
        const { content, toolName } = getMessageContentForFts(db, event.messageId);
        indexMessage(
          db,
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
