import type { SessionHarness } from '@prokopai/sdk';
import type { SessionExecutionPort } from '@/application/ports/execution';
import type { SessionRepositoryPort } from '@/application/ports/session';
import type { HeadlessSessionRunInput } from '@/application/ports/headless-execution';

export type HarnessOperation = 'editMessage' | 'regenerateTitle' | 'compact' | 'revert' | 'fork';

/** An adapter must own sending, interruption and live status. Other operations are opt-in. */
export type HarnessExecutor = Pick<SessionExecutionPort, 'sendMessage' | 'interruptSession' | 'isSessionActive'>
  & Partial<Pick<SessionExecutionPort, HarnessOperation | 'drainQueue'>>;

export interface HarnessRegistration {
  execution: HarnessExecutor;
  /** Headless (scheduled) child runs; absent means the harness cannot run
   * scheduled jobs and creation rejects it. */
  headless?: (input: HeadlessSessionRunInput) => Promise<{ error?: string }>;
  unsupportedMessages?: Partial<Record<HarnessOperation, string>>;
}

/** Resolve execution from the persisted owner, never from the selected model or provider. */
export function createHarnessExecution(
  repository: Pick<SessionRepositoryPort, 'getSession'>,
  registrations: Record<SessionHarness, HarnessRegistration>,
): SessionExecutionPort {
  const resolve = (sessionId: string): { owner: string; adapter?: HarnessRegistration; error?: string } => {
    const session = repository.getSession(sessionId);
    if (!session) return { owner: '', error: 'Session not found' };
    // A missing field from an older repository adapter represents a Prokop session.
    const owner = session.harness === undefined ? 'prokop' : session.harness;
    if (typeof owner !== 'string' || !Object.hasOwn(registrations, owner)) {
      return { owner: String(owner), error: 'Unknown session harness' };
    }
    return { owner, adapter: registrations[owner as SessionHarness] };
  };
  const unsupported = (target: ReturnType<typeof resolve>, operation: HarnessOperation): string =>
    target.adapter?.unsupportedMessages?.[operation]
      ?? (target.error || `${operation} is not supported for ${target.owner} sessions`);
  return {
    async drainQueue(wire, origin, sessionId) {
      await resolve(sessionId).adapter?.execution.drainQueue?.(wire, origin, sessionId);
    },
    async sendMessage(wire, origin, sessionId, content, attachments, responseFormatId, goalCondition, goalMaxTurns, goalTokenBudget) {
      const target = resolve(sessionId);
      if (!target.adapter) {
        wire.delivery.send(origin, { type: 'error', code: 'invalid_session', message: target.error!, sessionId });
        return;
      }
      if (goalTokenBudget !== undefined && (goalMaxTurns !== undefined || goalCondition === undefined)) {
        wire.delivery.send(origin, { type: 'error', code: 'invalid_session',
          message: 'A Codex token budget requires a goal and cannot use max turns', sessionId });
        return;
      }
      if (target.owner !== 'codex-cli' && goalTokenBudget !== undefined) {
        wire.delivery.send(origin, { type: 'error', code: 'invalid_session', message: 'Token budgets require a Codex session', sessionId });
        return;
      }
      await target.adapter.execution.sendMessage(
        wire, origin, sessionId, content, attachments, responseFormatId, goalCondition, goalMaxTurns, goalTokenBudget,
      );
    },
    async interruptSession(sessionId, reason) {
      const target = resolve(sessionId);
      if (!target.adapter) return { sessionId, success: false, cascadedTo: [], interruptedTools: [], rejectedAsks: [] };
      return target.adapter.execution.interruptSession(sessionId, reason);
    },
    isSessionActive(sessionId) {
      return resolve(sessionId).adapter?.execution.isSessionActive(sessionId) ?? false;
    },
    async editMessage(wire, origin, input) {
      const target = resolve(input.sessionId);
      if (!target.adapter?.execution.editMessage) {
        wire.delivery.send(origin, { type: 'error', code: 'invalid_session', sessionId: input.sessionId,
          message: unsupported(target, 'editMessage') });
        return;
      }
      await target.adapter.execution.editMessage(wire, origin, input);
    },
    async regenerateTitle(wire, origin, id, options) {
      const target = resolve(id);
      if (!target.adapter?.execution.regenerateTitle) {
        wire.delivery.send(origin, { type: 'error', code: 'invalid_session', sessionId: id,
          message: unsupported(target, 'regenerateTitle') });
        return;
      }
      await target.adapter.execution.regenerateTitle(wire, origin, id, options);
    },
    async compact(id, reason, delivery) {
      const target = resolve(id);
      if (!target.adapter?.execution.compact) {
        return { ok: false, skipped: true, error: unsupported(target, 'compact') };
      }
      return target.adapter.execution.compact(id, reason, delivery);
    },
    async revert(input) {
      const target = resolve(input.sessionId);
      if (!target.adapter?.execution.revert) {
        throw new Error(unsupported(target, 'revert'));
      }
      return target.adapter.execution.revert(input);
    },
    async fork(input) {
      const target = resolve(input.sessionId);
      if (!target.adapter?.execution.fork) {
        throw new Error(unsupported(target, 'fork'));
      }
      return target.adapter.execution.fork(input);
    },
  };
}
