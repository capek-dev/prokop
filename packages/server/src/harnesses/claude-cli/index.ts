import type { HarnessRegistration } from '@/application/sessions/harness-execution';
import type { SessionExecutionPort } from '@/application/ports/execution';

export { createClaudeExecution } from './execution';
export { claudeCliAvailable } from './version';
export { listClaudeModels, getClaudeModelSelection, saveClaudeModelSelection } from './models';

export function createClaudeCliHarness(
  execution: Pick<SessionExecutionPort, 'sendMessage' | 'interruptSession' | 'isSessionActive' | 'compact' | 'editMessage' | 'revert'>,
): HarnessRegistration {
  return { execution, unsupportedMessages: {
    regenerateTitle: 'Claude CLI title generation is not supported',
    fork: 'Claude CLI fork is not supported',
  } };
}
