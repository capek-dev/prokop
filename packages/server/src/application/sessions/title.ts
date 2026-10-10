import type { MessageWithParts, ServerMessage } from '@prokopai/sdk';
import type { SessionWirePorts } from '@/application/ports/delivery';
import type { SessionRepositoryPort } from '@/application/ports/session';
import type { TitleGenerationPort } from '@/application/ports/titles';

export interface SessionTitleDeps {
  repository: Pick<SessionRepositoryPort, 'getSession' | 'updateSession' | 'listLatestMessagesWithPartsPage'>;
  titles: TitleGenerationPort;
  /**
   * The harness CLI's own title for the session, used when no Prokop model
   * produced one. Absent for harnesses whose CLI has no free title.
   */
  harnessTitle?: (sessionId: string) => Promise<string | null>;
  /** Transcript read bound; the store clamps it to its own maximum (100). */
  transcriptLimit?: number;
}

/** Marks a title made from the first prompt's words; later turns may replace it. */
const FALLBACK_TITLE_KEY = 'titleFallback';

type TitleSource = 'model' | 'harness' | 'fallback';

function withFallbackMark(metadata: Record<string, unknown> | null | undefined, fallback: boolean): Record<string, unknown> {
  const { [FALLBACK_TITLE_KEY]: _previous, ...rest } = metadata ?? {};
  return fallback ? { ...rest, [FALLBACK_TITLE_KEY]: true } : rest;
}

/**
 * Universal server-side session-title regeneration (S11.3 slice 2).
 *
 * Mirrors the Capek regeneration semantics so every harness gets identical
 * behavior: without force, regenerate only default titles that were never
 * renamed manually; read the newest transcript page (chronological order),
 * generate, persist, and broadcast session.renamed to every client.
 *
 * Users of the CLI harnesses may have no Prokop model, so the title comes
 * from the first source that answers: the Prokop model, the harness CLI's own
 * title, then the first prompt's words. A first-prompt title stays
 * replaceable by later turns. Only a forced (user-requested) regeneration
 * reports title_generation_error; the automatic one after each turn is quiet.
 * The Prokop harness keeps its Capek implementation; external harnesses
 * register this one.
 */
export function createSessionTitleRegeneration<Origin>(deps: SessionTitleDeps) {
  const transcriptLimit = deps.transcriptLimit ?? 100;

  async function generate(
    sessionId: string,
    messages: MessageWithParts[],
  ): Promise<{ title: string; source: TitleSource } | null> {
    try {
      const title = await deps.titles.generateSessionTitle(messages);
      if (title) return { title, source: 'model' };
    } catch (err: unknown) {
      // No configured Prokop model lands here too; the next sources cover it.
      const message = err instanceof Error ? err.message : String(err);
      console.info('[session-title] Prokop title model unavailable, trying other sources', { sessionId, message });
    }
    if (deps.harnessTitle) {
      try {
        const title = await deps.harnessTitle(sessionId);
        if (title) return { title, source: 'harness' };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn('[session-title] Failed to read harness title', { sessionId, message });
      }
    }
    const title = deps.titles.fallbackSessionTitle(messages);
    return title ? { title, source: 'fallback' } : null;
  }

  return async function regenerateSessionTitle(
    wire: SessionWirePorts<Origin>,
    origin: Origin,
    sessionId: string,
    options?: { force?: boolean },
  ): Promise<void> {
    const force = options?.force === true;
    const session = deps.repository.getSession(sessionId);
    if (!session) {
      console.warn('[session-title] Skipping title generation: session not found', sessionId);
      return;
    }
    const replaceable = deps.titles.isDefaultSessionTitle(session.title)
      || session.metadata?.[FALLBACK_TITLE_KEY] === true;
    if (!force && (!replaceable || deps.titles.hasManualSessionTitle(session.metadata))) {
      console.info('[session-title] Skipping auto title generation', {
        sessionId,
        title: session.title,
        manuallyRenamed: deps.titles.hasManualSessionTitle(session.metadata),
      });
      return;
    }

    const failure = (message: string): void => {
      if (!force) return;
      const error: ServerMessage = { type: 'error', code: 'title_generation_error', message, sessionId };
      wire.delivery.send(origin, error);
    };

    try {
      const page = deps.repository.listLatestMessagesWithPartsPage(sessionId, transcriptLimit);
      console.info('[session-title] Generating session title', {
        sessionId,
        force,
        messageCount: page.messages.length,
      });
      const generated = await generate(sessionId, page.messages);
      if (!generated) {
        console.warn('[session-title] Skipping title update: no title generated', sessionId);
        failure('Could not generate a title from the conversation.');
        return;
      }
      // Generation awaits a model or a file; re-read so a rename or metadata
      // change made meanwhile is neither overwritten nor lost.
      const current = deps.repository.getSession(sessionId);
      if (!current || (!force && deps.titles.hasManualSessionTitle(current.metadata))) return;
      const fallback = generated.source === 'fallback';
      const markChanged = (current.metadata?.[FALLBACK_TITLE_KEY] === true) !== fallback;
      if (current.title === generated.title && !markChanged) return;
      const updated = deps.repository.updateSession(sessionId, {
        title: generated.title,
        ...(markChanged ? { metadata: withFallbackMark(current.metadata, fallback) } : {}),
      });
      if (updated) {
        console.info('[session-title] Updated session title', { sessionId, title: generated.title, source: generated.source });
        // Session lists show titles, so every client hears it, not only those with the session open.
        wire.delivery.broadcast({ type: 'session.renamed', session: updated });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[session-title] Failed to generate session title', { sessionId, message });
      failure(`Title generation failed: ${message}`);
    }
  };
}
