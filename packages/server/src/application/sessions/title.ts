import type { ServerMessage } from '@prokopai/sdk';
import type { SessionWirePorts } from '@/application/ports/delivery';
import type { SessionRepositoryPort } from '@/application/ports/session';
import type { TitleGenerationPort } from '@/application/ports/titles';

export interface SessionTitleDeps {
  repository: Pick<SessionRepositoryPort, 'getSession' | 'updateSession' | 'listLatestMessagesWithPartsPage'>;
  titles: TitleGenerationPort;
  /** Transcript read bound; the store clamps it to its own maximum (100). */
  transcriptLimit?: number;
}

/**
 * Universal server-side session-title regeneration (S11.3 slice 2).
 *
 * Mirrors the Capek regeneration semantics so every harness gets identical
 * behavior: without force, regenerate only default titles that were never
 * renamed manually; read the newest transcript page (chronological order),
 * generate, persist, and broadcast session.renamed to the session audience;
 * report title_generation_error to the requesting origin when generation
 * returns nothing or throws. The Prokop harness keeps its Capek
 * implementation; external harnesses register this one.
 */
export function createSessionTitleRegeneration<Origin>(deps: SessionTitleDeps) {
  const transcriptLimit = deps.transcriptLimit ?? 100;
  return async function regenerateSessionTitle(
    wire: SessionWirePorts<Origin>,
    origin: Origin,
    sessionId: string,
    options?: { force?: boolean },
  ): Promise<void> {
    const session = deps.repository.getSession(sessionId);
    if (!session) {
      console.warn('[session-title] Skipping title generation: session not found', sessionId);
      return;
    }
    if (!options?.force
      && (!deps.titles.isDefaultSessionTitle(session.title) || deps.titles.hasManualSessionTitle(session.metadata))) {
      console.info('[session-title] Skipping auto title generation', {
        sessionId,
        title: session.title,
        manuallyRenamed: deps.titles.hasManualSessionTitle(session.metadata),
      });
      return;
    }

    const failure = (message: string): void => {
      const error: ServerMessage = { type: 'error', code: 'title_generation_error', message, sessionId };
      wire.delivery.send(origin, error);
    };

    try {
      const page = deps.repository.listLatestMessagesWithPartsPage(sessionId, transcriptLimit);
      console.info('[session-title] Generating session title', {
        sessionId,
        force: options?.force === true,
        messageCount: page.messages.length,
      });
      const title = await deps.titles.generateSessionTitle(page.messages);
      if (!title) {
        console.warn('[session-title] Skipping title update: no title generated', sessionId);
        failure('Could not generate a title from the conversation.');
        return;
      }
      const updated = deps.repository.updateSession(sessionId, { title });
      if (updated) {
        console.info('[session-title] Updated session title', { sessionId, title });
        wire.delivery.broadcastToSession(sessionId, { type: 'session.renamed', session: updated });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[session-title] Failed to generate session title', { sessionId, message });
      failure(`Title generation failed: ${message}`);
    }
  };
}
