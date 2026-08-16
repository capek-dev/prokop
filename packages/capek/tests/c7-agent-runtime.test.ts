import { describe, expect, test } from 'bun:test';
import { createAgentScope, createProcessScope } from '../src/kernel/kernel';
import type { AgentDriver, AgentRunContext } from '../src/runtime/agent-runtime';
import { createAgentRuntime } from '../src/runtime/agent-runtime';
import { DefaultAgentDriver, type DefaultDriverInput } from '../src/runtime/default-agent-driver';

async function scopes() {
  const processScope = await createProcessScope([]);
  const agentScope = await createAgentScope(processScope, []);
  return { processScope, agentScope };
}

describe('C7 agent runtime', () => {
  test('runs through a replaceable driver and disposes the run scope', async () => {
    const { processScope, agentScope } = await scopes();
    let captured: AgentRunContext | undefined;
    const alternateDriver: AgentDriver<string, string> = {
      async run(context, input) {
        captured = context;
        return input.toUpperCase();
      },
    };
    const runtime = createAgentRuntime({ agentScope, driver: alternateDriver });

    expect(await runtime.run('alternate-run', 'alternate')).toBe('ALTERNATE');
    expect(captured?.runId).toBe('alternate-run');
    expect(captured?.scope.runStatus).toBe('disposed');
    await processScope.dispose();
  });

  test('marks driver failure terminal and disposes the run scope', async () => {
    const { processScope, agentScope } = await scopes();
    let captured: AgentRunContext | undefined;
    const driver: AgentDriver<void, void> = {
      async run(context) {
        captured = context;
        throw new Error('driver failed');
      },
    };
    const runtime = createAgentRuntime({ agentScope, driver });

    await expect(runtime.run('failed-run', undefined)).rejects.toThrow('driver failed');
    expect(captured?.scope.runStatus).toBe('disposed');
    await processScope.dispose();
  });

  test('aborts the driver before completing cancellation cleanup', async () => {
    const { processScope, agentScope } = await scopes();
    const controller = new AbortController();
    const order: string[] = [];
    const driver: AgentDriver<void, void> = {
      async run(context) {
        await new Promise<void>((resolve) => {
          context.signal.addEventListener('abort', () => {
            order.push('driver-aborted');
            resolve();
          }, { once: true });
        });
      },
    };
    const runtime = createAgentRuntime({ agentScope, driver });
    const running = runtime.run('cancelled-run', undefined, {
      signal: controller.signal,
      cancellationReason: 'test cancellation',
    });

    await Bun.sleep(0);
    controller.abort(new Error('stop'));
    await running;
    order.push('runtime-completed');

    expect(order).toEqual(['driver-aborted', 'runtime-completed']);
    await processScope.dispose();
  });

  test('default driver continues only when advancement reports capability work', async () => {
    const { processScope, agentScope } = await scopes();
    let advances = 0;
    const driver = new DefaultAgentDriver() as AgentDriver<DefaultDriverInput<string>, string>;
    const runtime = createAgentRuntime({ agentScope, driver });

    const result = await runtime.run('default-run', {
      async advance() {
        advances += 1;
        return {
          result: `turn-${advances}`,
          continuation: advances === 1 ? 'continue' : 'complete',
        };
      },
    });

    expect(result).toBe('turn-2');
    expect(advances).toBe(2);
    await processScope.dispose();
  });
});
