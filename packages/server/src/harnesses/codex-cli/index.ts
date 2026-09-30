import type { HarnessRegistration } from '@/application/sessions/harness-execution';
import type { SessionExecutionPort } from '@/application/ports/execution';

export { codexCliAvailable, codexCliVersion, createCodexExecution } from './execution';
export { getCodexModelSelection, listCodexModels, saveCodexModelSelection } from './models';

/** Codex CLI owns turns and model choice; titles use the universal
 * server-side regeneration supplied by the composition root. */
export function createCodexCliHarness(
  execution: Pick<SessionExecutionPort, 'sendMessage' | 'interruptSession' | 'isSessionActive' | 'editMessage' | 'revert' | 'fork' | 'compact'>,
  regenerateTitle: SessionExecutionPort['regenerateTitle'],
): HarnessRegistration {
  return {
    execution: {
      ...execution,
      regenerateTitle,
    },
  };
}
