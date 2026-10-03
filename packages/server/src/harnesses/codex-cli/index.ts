import type { HarnessRegistration } from '@/application/sessions/harness-execution';
import type { SessionExecutionPort } from '@/application/ports/execution';
import { runHeadlessTurn } from '@/application/ports/headless-execution';

export { codexCliAvailable, codexCliVersion, createCodexExecution } from './execution';
export { getCodexModelSelection, listCodexModels, listCachedCodexModels, saveCodexModelSelection } from './models';
export { readCachedCodexUsageLimits } from './usage-limits';

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
    // Headless child runs (scheduled jobs, learning reviews) drive a normal
    // turn with no client attached; sendMessage resolves at turn completion.
    headless: input => runHeadlessTurn(execution.sendMessage, input),
  };
}
