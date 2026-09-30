import type { LearningRuntimePort } from '@/application/ports/learning-runtime';
import { createLearningDirectoryResolver } from './learning-directories';
import { createLearningHistory } from './learning-history';
import { createLearningExecution, type LearningExecutionDependencies } from './learning-execution';

export interface ProkopLearningRuntimeOptions {
  agents: Parameters<typeof createLearningDirectoryResolver>[0];
  /** Test seam replacing the learning composition execution. */
  executeOverride?: LearningExecutionDependencies['execute'];
}

/**
 * The Prokop learning runtime behind the application LearningRuntimePort.
 * Repository and database handles stay caller-owned: bootstrap and tests
 * pass them through the assembly methods, keeping this factory free of
 * persistence wiring.
 */
export function createProkopLearningRuntime(options: ProkopLearningRuntimeOptions): LearningRuntimePort<
  LearningExecutionDependencies['repository'],
  LearningExecutionDependencies['database']
> {
  const directories = createLearningDirectoryResolver(options.agents);
  return {
    harness: 'prokop',
    directories,
    createHistory: deps => createLearningHistory(deps),
    createExecution: deps => createLearningExecution({ ...deps, execute: options.executeOverride }),
  };
}
