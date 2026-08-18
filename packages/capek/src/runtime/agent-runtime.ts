import type { CapekPlugin, AgentScopeHandle, RunScopeHandle } from '../kernel/types';

export interface AgentRunContext {
  runId: string;
  signal: AbortSignal;
  scope: RunScopeHandle;
}

export interface AgentDriver<Input, Result> {
  run(context: AgentRunContext, input: Input): Promise<Result>;
}

export interface AgentRuntimeRunOptions {
  signal?: AbortSignal;
  cancellationReason?: string;
}

export interface AgentRuntime<Input, Result> {
  run(runId: string, input: Input, options?: AgentRuntimeRunOptions): Promise<Result>;
}

export interface AgentRuntimeOptions<Input, Result> {
  agentScope: AgentScopeHandle;
  driver: AgentDriver<Input, Result>;
  runPlugins?: (input: Input) => readonly CapekPlugin<unknown>[];
}

export function createAgentRuntime<Input, Result>(
  options: AgentRuntimeOptions<Input, Result>,
): AgentRuntime<Input, Result> {
  return {
    async run(runId, input, runOptions = {}) {
      const runScope = await options.agentScope.createRunScope(
        runId,
        options.runPlugins?.(input) ?? [],
      );
      const controller = new AbortController();
      const cancel = (): void => {
        if (!controller.signal.aborted) {
          controller.abort(runOptions.signal?.reason ?? new Error(runOptions.cancellationReason ?? 'Agent run cancelled'));
        }
        runScope.cancel(runOptions.cancellationReason ?? 'caller signal');
      };
      runOptions.signal?.addEventListener('abort', cancel, { once: true });

      try {
        if (runOptions.signal?.aborted) {
          cancel();
          throw controller.signal.reason;
        }
        await runScope.start();
        const execution = options.driver.run({ runId, signal: controller.signal, scope: runScope }, input);
        const barrier = runScope.registerCleanupBarrier(execution.then(() => {}, () => {}));
        try {
          const result = await execution;
          await runScope.markTerminal('completed');
          return result;
        } finally {
          barrier.dispose();
        }
      } catch (error: unknown) {
        if (runScope.runStatus === 'created' || runScope.runStatus === 'running') {
          if (controller.signal.aborted || runOptions.signal?.aborted) {
            await runScope.cancel(runOptions.cancellationReason ?? 'caller signal').completion;
          } else {
            await runScope.markTerminal('failed');
          }
        }
        throw error;
      } finally {
        if (!controller.signal.aborted) {
          controller.abort(new Error('Agent run settled'));
        }
        runOptions.signal?.removeEventListener('abort', cancel);
        if (runScope.runStatus === 'created' || runScope.runStatus === 'running') {
          await runScope.cancel('runtime cleanup').completion;
        } else {
          await runScope.dispose();
        }
      }
    },
  };
}
