import type { HarnessRegistration } from '@/application/sessions/harness-execution';
import {
  createJean2HeadlessExecution,
  createJean2SessionExecution,
  type Jean2SessionExecutionDependencies,
} from './execution';

/** The Prokop harness enters the composed Čapek agent scope through its
 * execution adapter, including headless scheduled child runs. */
export function createProkopHarness(dependencies: Jean2SessionExecutionDependencies = {}): HarnessRegistration {
  return {
    execution: createJean2SessionExecution(dependencies),
    headless: createJean2HeadlessExecution(dependencies),
  };
}
