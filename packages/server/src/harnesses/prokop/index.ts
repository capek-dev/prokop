import type { HarnessRegistration } from '@/application/sessions/harness-execution';
import { createJean2SessionExecution, type Jean2SessionExecutionDependencies } from './execution';

/** The Prokop harness enters the composed Čapek agent scope through its execution adapter. */
export function createProkopHarness(dependencies: Jean2SessionExecutionDependencies = {}): HarnessRegistration {
  return { execution: createJean2SessionExecution(dependencies) };
}
