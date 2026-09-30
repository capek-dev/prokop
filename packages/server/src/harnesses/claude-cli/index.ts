import type { HarnessRegistration } from '@/application/sessions/harness-execution';
import type { SessionExecutionPort } from '@/application/ports/execution';

export { createClaudeExecution } from './execution';
export { claudeCliAvailable } from './version';
export { listClaudeModels, getClaudeModelSelection, saveClaudeModelSelection } from './models';

/** Claude CLI owns turns and model choice; titles use the universal
 * server-side regeneration supplied by the composition root. */
export function createClaudeCliHarness(
  execution: Pick<SessionExecutionPort, 'sendMessage' | 'interruptSession' | 'isSessionActive' | 'compact' | 'editMessage' | 'revert' | 'fork'>,
  regenerateTitle: SessionExecutionPort['regenerateTitle'],
): HarnessRegistration {
  return {
    execution: {
      ...execution,
      regenerateTitle,
    },
  };
}
