import { afterEach, describe, expect, test } from 'bun:test';
import type { ScheduledJob } from '@jean2/sdk';
import type {
  executeCompaction as CapekExecuteCompaction,
  forkSession as CapekForkSession,
  handleChat as CapekHandleChat,
  handleSessionEditMessage as CapekHandleSessionEditMessage,
  regenerateSessionTitle as CapekRegenerateSessionTitle,
  revertToStep as CapekRevertToStep,
} from '@capekai/core/execution';
import {
  configureStorage,
  createInMemoryStorageBundle,
  getStorage,
} from '@capekai/core/storage';
import { configureJean2Bindings } from '@/adapters/capek/bindings';
import { configureJean2RuntimeConfiguration } from '@/adapters/capek/runtime-configuration';
import { configureJean2Storage, jean2StorageBundle } from '@/adapters/capek/storage';
import { configureJean2ToolSource } from '@/adapters/capek/tool-source';
import {
  createJean2SessionExecution,
  type Jean2SessionExecutionDependencies,
} from '@/adapters/capek/execution';
import { createJean2ScheduledJobExecution } from '@/adapters/jean2/scheduled-job-execution';
import {
  disposeJean2ExecutionScope,
  getJean2ExecutionComposition,
  initializeJean2ExecutionScope,
  resetJean2ExecutionCompositionFactoryForTests,
  setJean2ExecutionCompositionFactoryForTests,
  withJean2ExecutionScope,
} from '@/adapters/capek/execution-scope';

describe('Jean2 composed execution scope', () => {
  afterEach(async () => {
    await disposeJean2ExecutionScope();
    resetJean2ExecutionCompositionFactoryForTests();
    configureStorage(createInMemoryStorageBundle());
  });

  function configureComposition(): void {
    configureJean2Storage();
    configureJean2RuntimeConfiguration();
    configureJean2ToolSource();
    configureJean2Bindings();
  }

  test('enters one cached agent scope and preserves it across async suspension', async () => {
    configureComposition();

    const composition = await getJean2ExecutionComposition();
    expect(await getJean2ExecutionComposition()).toBe(composition);

    const fallbackStorage = createInMemoryStorageBundle();
    configureStorage(fallbackStorage);

    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });

    const execution = withJean2ExecutionScope(async () => {
      expect(getStorage()).toBe(jean2StorageBundle);
      await barrier;
      expect(getStorage()).toBe(jean2StorageBundle);
      return 'completed';
    });

    release();
    expect(await execution).toBe('completed');
    expect(getStorage()).toBe(fallbackStorage);
  });

  test('all stateful session execution entries enter the composed scope across suspension', async () => {
    configureComposition();
    await getJean2ExecutionComposition();

    const fallbackStorage = createInMemoryStorageBundle();
    configureStorage(fallbackStorage);
    const observations = new Map<string, unknown[]>();

    async function observe(name: string): Promise<void> {
      const values = observations.get(name) ?? [];
      values.push(getStorage());
      observations.set(name, values);
      await Promise.resolve();
      values.push(getStorage());
    }

    const dependencies: Jean2SessionExecutionDependencies = {
      handleChat: async (..._args: Parameters<typeof CapekHandleChat>): Promise<void> => observe('chat'),
      handleSessionEditMessage: async (..._args: Parameters<typeof CapekHandleSessionEditMessage>): Promise<void> =>
        observe('edit'),
      regenerateSessionTitle: async (..._args: Parameters<typeof CapekRegenerateSessionTitle>): Promise<void> =>
        observe('title'),
      executeCompaction: async (..._args: Parameters<typeof CapekExecuteCompaction>) => {
        await observe('compact');
        return { ok: false, error: 'test' } as Awaited<ReturnType<typeof CapekExecuteCompaction>>;
      },
      revertToStep: async (..._args: Parameters<typeof CapekRevertToStep>) => {
        await observe('revert');
        return {} as Awaited<ReturnType<typeof CapekRevertToStep>>;
      },
      forkSession: async (..._args: Parameters<typeof CapekForkSession>) => {
        await observe('fork');
        return {} as Awaited<ReturnType<typeof CapekForkSession>>;
      },
    };
    const execution = createJean2SessionExecution(dependencies);
    const wire = {
      delivery: {
        send: () => {},
        broadcast: () => {},
        broadcastToSession: () => {},
        sendToController: () => {},
        sendToAskTargets: () => {},
      },
      actor: { attachOriginToSession: () => {} },
    } as never;

    await execution.sendMessage(wire, 'origin', 'session', 'content');
    await execution.editMessage(wire, 'origin', {
      sessionId: 'session',
      messageId: 'message',
      content: 'edited',
    });
    await execution.regenerateTitle(wire, 'origin', 'session', { force: true });
    await execution.compact('session', 'manual');
    await execution.revert({ sessionId: 'session', targetMessageId: 'message' });
    await execution.fork({ sessionId: 'session', targetMessageId: 'message' });

    expect([...observations.keys()]).toEqual(['chat', 'edit', 'title', 'compact', 'revert', 'fork']);
    for (const values of observations.values()) {
      expect(values).toEqual([jean2StorageBundle, jean2StorageBundle]);
    }
    expect(getStorage()).toBe(fallbackStorage);
  });

  test('shutdown rejects new entries, drains active work, and disposes once', async () => {
    configureComposition();
    await getJean2ExecutionComposition();

    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });

    const execution = withJean2ExecutionScope(async () => {
      markStarted();
      await barrier;
    });
    await started;

    let disposed = false;
    const firstDisposal = disposeJean2ExecutionScope();
    void firstDisposal.then(() => {
      disposed = true;
    });
    const secondDisposal = disposeJean2ExecutionScope();
    expect(secondDisposal).toBe(firstDisposal);
    await Promise.resolve();
    expect(disposed).toBe(false);
    expect(() => withJean2ExecutionScope(async () => {})).toThrow('shutting down');

    release();
    await execution;
    await firstDisposal;
    expect(disposed).toBe(true);
    expect(() => getJean2ExecutionComposition()).toThrow('shutting down');

    await initializeJean2ExecutionScope();
    expect(await getJean2ExecutionComposition()).toBeDefined();
  });

  test('failed composition does not poison retry or cleanup', async () => {
    let attempts = 0;
    setJean2ExecutionCompositionFactoryForTests(async () => {
      attempts += 1;
      throw new Error('composition failed');
    });

    const failed = getJean2ExecutionComposition();
    await disposeJean2ExecutionScope();
    let failure: unknown;
    try {
      await failed;
    } catch (error: unknown) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);

    resetJean2ExecutionCompositionFactoryForTests();
    configureComposition();
    const recovered = await getJean2ExecutionComposition();
    expect(recovered.agentScope).toBeDefined();
    expect(attempts).toBe(1);
  });

  test('scheduled run and fire-and-forget trigger enter the composed scope', async () => {
    configureComposition();
    await getJean2ExecutionComposition();
    configureStorage(createInMemoryStorageBundle());

    const observedStorages: unknown[] = [];
    let resolveTrigger: (() => void) | undefined;
    const runner = {
      async run(_job: ScheduledJob): Promise<void> {
        observedStorages.push(getStorage());
        await Promise.resolve();
        observedStorages.push(getStorage());
        if (observedStorages.length === 4) {
          resolveTrigger?.();
        }
      },
    };
    const execution = createJean2ScheduledJobExecution(runner);

    await execution.run({} as ScheduledJob);
    expect(observedStorages[0]).toBe(jean2StorageBundle);
    expect(observedStorages[1]).toBe(jean2StorageBundle);

    const triggered = new Promise<void>((resolve) => {
      resolveTrigger = resolve;
    });
    execution.trigger({} as ScheduledJob);
    await triggered;
    expect(observedStorages[2]).toBe(jean2StorageBundle);
    expect(observedStorages[3]).toBe(jean2StorageBundle);
  });
});
