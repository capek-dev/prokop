import type { SessionExecutionPort } from '@/application/ports/execution';
import type { SessionRepositoryPort } from '@/application/ports/session';

/** Dispatch by the persisted session owner, never by selected model/provider. */
export function createHarnessExecution(
  repository: Pick<SessionRepositoryPort, 'getSession'>,
  prokop: SessionExecutionPort,
  codex: Pick<SessionExecutionPort, 'sendMessage' | 'interruptSession' | 'isSessionActive'>,
): SessionExecutionPort {
  const isCodex = (sessionId: string): boolean => repository.getSession(sessionId)?.harness === 'codex-cli';
  return {
    sendMessage: (wire, origin, sessionId, content, attachments, responseFormatId, goalCondition, goalMaxTurns) =>
      isCodex(sessionId)
        ? codex.sendMessage(wire, origin, sessionId, content, attachments, responseFormatId, goalCondition, goalMaxTurns)
        : prokop.sendMessage(wire, origin, sessionId, content, attachments, responseFormatId, goalCondition, goalMaxTurns),
    interruptSession: (id, reason) => isCodex(id)
      ? codex.interruptSession(id, reason) : prokop.interruptSession(id, reason),
    isSessionActive: id => isCodex(id) ? codex.isSessionActive(id) : prokop.isSessionActive(id),
    editMessage: (wire, origin, input) => isCodex(input.sessionId)
      ? Promise.resolve(wire.delivery.send(origin, { type: 'error', code: 'invalid_session',
        message: 'Editing is not supported for Codex CLI sessions', sessionId: input.sessionId }))
      : prokop.editMessage(wire, origin, input),
    regenerateTitle: (wire, origin, id, options) => isCodex(id)
      ? Promise.resolve(wire.delivery.send(origin, { type: 'error', code: 'invalid_session',
        message: 'Title generation is not supported for Codex CLI sessions', sessionId: id }))
      : prokop.regenerateTitle(wire, origin, id, options),
    compact: (id, reason) => isCodex(id)
      ? Promise.resolve({ ok: false as const, error: 'Compaction is not supported for Codex CLI sessions', skipped: true })
      : prokop.compact(id, reason),
    revert: input => isCodex(input.sessionId)
      ? Promise.reject(new Error('Revert is not supported for Codex CLI sessions')) : prokop.revert(input),
    fork: input => isCodex(input.sessionId)
      ? Promise.reject(new Error('Fork is not supported for Codex CLI sessions')) : prokop.fork(input),
  };
}
