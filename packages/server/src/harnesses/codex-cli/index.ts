import type { HarnessRegistration } from '@/application/sessions/harness-execution';
import type { SessionExecutionPort } from '@/application/ports/execution';

export { codexCliAvailable, codexCliVersion, createCodexExecution } from './execution';
export { getCodexModelSelection, listCodexModels, saveCodexModelSelection } from './models';

/** Codex CLI owns turns and model choice; unsupported Čapek operations remain explicit. */
export function createCodexCliHarness(
  execution: Pick<SessionExecutionPort, 'sendMessage' | 'interruptSession' | 'isSessionActive'>,
): HarnessRegistration {
  return {
    execution,
    unsupportedMessages: {
      editMessage: 'Editing is not supported for Codex CLI sessions',
      regenerateTitle: 'Title generation is not supported for Codex CLI sessions',
      compact: 'Compaction is not supported for Codex CLI sessions',
      revert: 'Revert is not supported for Codex CLI sessions',
      fork: 'Fork is not supported for Codex CLI sessions',
    },
  };
}
