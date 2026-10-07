import { afterEach, describe, expect, test } from 'bun:test';
import type { executeCompaction as CapekExecuteCompaction } from '@/harnesses/prokop/compaction/executor';
import type { forkSession as CapekForkSession } from '@/harnesses/prokop/execution/fork';
import type {
  handleChat as CapekHandleChat,
  handleSessionEditMessage as CapekHandleSessionEditMessage,
  regenerateSessionTitle as CapekRegenerateSessionTitle,
} from '@/harnesses/prokop/execution/chat-handler';
import type { revertToStep as CapekRevertToStep } from '@/harnesses/prokop/execution/revert';
import { configureStorage, getStorage } from '@/infrastructure/storage/runtime';
import { createInMemoryStorageBundle } from '@/infrastructure/storage/memory';
import { configureProkopBindings } from '@/harnesses/prokop/composition/bindings';
import { configureProkopRuntimeConfiguration } from '@/harnesses/prokop/host/runtime-configuration';
import { configureProkopStorage, prokopStorageBundle } from '@/harnesses/prokop/host/storage';
import { configureProkopWorkspaceToolDiscovery } from '@/harnesses/prokop/host/tool-source';
import { createProkopSessionExecution, type ProkopSessionExecutionDependencies } from '@/harnesses/prokop/execution';
import { createProkopHarness } from '@/harnesses/prokop';
import {
  disposeProkopExecutionScope,
  getProkopExecutionComposition,
  initializeProkopExecutionScope,
  resetProkopExecutionCompositionFactoryForTests,
  setProkopExecutionCompositionFactoryForTests,
  withProkopExecutionScope,
} from '@/harnesses/prokop/composition/execution-scope';

describe('Jean2 composed execution scope', () => {
  afterEach(async () => {
    await disposeProkopExecutionScope();
    resetProkopExecutionCompositionFactoryForTests();
    configureStorage(createInMemoryStorageBundle());
  });

  function configureComposition(): void {
    configureProkopStorage();
    configureProkopRuntimeConfiguration();
    configureProkopWorkspaceToolDiscovery();
    configureProkopBindings();
  }

  test('enters one cached agent scope and preserves it across async suspension', async () => {
    configureComposition();

    const composition = await getProkopExecutionComposition();
    expect(await getProkopExecutionComposition()).toBe(composition);

    const fallbackStorage = createInMemoryStorageBundle();
    configureStorage(fallbackStorage);

    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });

    const execution = withProkopExecutionScope(async () => {
      expect(getStorage()).toBe(prokopStorageBundle);
      await barrier;
      expect(getStorage()).toBe(prokopStorageBundle);
      return 'completed';
    });

    release();
    expect(await execution).toBe('completed');
    expect(getStorage()).toBe(fallbackStorage);
  });

  test('all stateful session execution entries enter the composed scope across suspension', async () => {
    configureComposition();
    await getProkopExecutionComposition();

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

    const dependencies: ProkopSessionExecutionDependencies = {
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
    const execution = createProkopSessionExecution(dependencies);
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
      expect(values).toEqual([prokopStorageBundle, prokopStorageBundle]);
    }
    expect(getStorage()).toBe(fallbackStorage);
  });

  test('shutdown rejects new entries, drains active work, and disposes once', async () => {
    configureComposition();
    await getProkopExecutionComposition();

    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });

    const execution = withProkopExecutionScope(async () => {
      markStarted();
      await barrier;
    });
    await started;

    let disposed = false;
    const firstDisposal = disposeProkopExecutionScope();
    void firstDisposal.then(() => {
      disposed = true;
    });
    const secondDisposal = disposeProkopExecutionScope();
    expect(secondDisposal).toBe(firstDisposal);
    await Promise.resolve();
    expect(disposed).toBe(false);
    expect(() => withProkopExecutionScope(async () => {})).toThrow('shutting down');

    release();
    await execution;
    await firstDisposal;
    expect(disposed).toBe(true);
    expect(() => getProkopExecutionComposition()).toThrow('shutting down');

    await initializeProkopExecutionScope();
    expect(await getProkopExecutionComposition()).toBeDefined();
  });

  test('failed composition does not poison retry or cleanup', async () => {
    let attempts = 0;
    setProkopExecutionCompositionFactoryForTests(async () => {
      attempts += 1;
      throw new Error('composition failed');
    });

    const failed = getProkopExecutionComposition();
    await disposeProkopExecutionScope();
    let failure: unknown;
    try {
      await failed;
    } catch (error: unknown) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);

    resetProkopExecutionCompositionFactoryForTests();
    configureComposition();
    const recovered = await getProkopExecutionComposition();
    expect(recovered.agentScope).toBeDefined();
    expect(attempts).toBe(1);
  });

  test('headless scheduled run enters the composed scope across suspension', async () => {
    configureComposition();
    await getProkopExecutionComposition();
    configureStorage(createInMemoryStorageBundle());

    const observedStorages: unknown[] = [];
    const registration = createProkopHarness({
      executeChildSession: async () => {
        observedStorages.push(getStorage());
        await Promise.resolve();
        observedStorages.push(getStorage());
        return { parts: [] };
      },
    });

    await registration.headless!({
      harness: 'prokop',
      parentSessionId: 'scheduled-session',
      childSessionId: 'scheduled-session',
      preconfig: {} as never,
      prompt: 'nightly checks',
      workspacePath: undefined,
      workspaceId: 'workspace-1',
      modelId: 'm',
      providerId: 'p',
      resumeFromHistory: false,
    });

    expect(observedStorages[0]).toBe(prokopStorageBundle);
    expect(observedStorages[1]).toBe(prokopStorageBundle);
  });
});
