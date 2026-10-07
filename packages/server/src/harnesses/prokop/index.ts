import type { HarnessRegistration } from '@/application/sessions/harness-execution';
import {
  createProkopHeadlessExecution,
  createProkopSessionExecution,
  type ProkopSessionExecutionDependencies,
} from './execution';

/** The Prokop harness enters the composed Čapek agent scope through its
 * execution adapter, including headless scheduled child runs. */
export function createProkopHarness(dependencies: ProkopSessionExecutionDependencies = {}): HarnessRegistration {
  return {
    execution: createProkopSessionExecution(dependencies),
    headless: createProkopHeadlessExecution(dependencies),
  };
}
