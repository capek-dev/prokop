import type { HarnessRegistration } from '@/application/sessions/harness-execution';
import type { SessionExecutionPort } from '@/application/ports/execution';
import { runHeadlessTurn } from '@/application/ports/headless-execution';

export { createClaudeExecution } from './execution';
export { claudeCliAvailable, claudeCliVersion } from './version';
export { listClaudeModels, listCachedClaudeModels, getClaudeModelSelection, saveClaudeModelSelection } from './models';

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
    // Headless child runs (scheduled jobs, learning reviews) drive a normal
    // turn with no client attached; sendMessage resolves at turn completion.
    headless: input => runHeadlessTurn(execution.sendMessage, input),
  };
}
