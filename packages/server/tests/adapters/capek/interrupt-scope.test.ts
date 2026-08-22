import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createAskApi } from '@capekai/core/ask-authority';
import {
  configureStorage,
  createInMemoryStorageBundle,
} from '@capekai/core/storage';
import type { AskRequestMessage, AskTimedOutMessage } from '@prokopai/sdk';
import { createJean2SessionExecution } from '@/adapters/capek/execution';
import { configureJean2Bindings } from '@/adapters/capek/bindings';
import { configureJean2RuntimeConfiguration } from '@/adapters/capek/runtime-configuration';
import { configureJean2Storage } from '@/adapters/capek/storage';
import { configureJean2WorkspaceToolDiscovery } from '@/adapters/capek/tool-source';
import {
  disposeJean2ExecutionScope,
  initializeJean2ExecutionScope,
  resetJean2ExecutionCompositionFactoryForTests,
  withJean2ExecutionScope,
} from '@/adapters/capek/execution-scope';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspaceWithSession } from '#tests/seed';

// ---------------------------------------------------------------------------
// Regression: session.interrupt arrives on the wire outside any execution
// context. Since b962b7b the running tool's ctx.ask() waiter lives in the
// composed permission runtime, but interruptSession rejected pending asks
// through the process-default runtime, whose waiter map is empty. The
// question tool stayed blocked on ctx.ask() forever and the session stayed
// registered as running (bricked). The interrupt must enter the composed
// scope so the waiter rejects and the stream unwinds.
// ---------------------------------------------------------------------------

function neverResolves(ms: number): Promise<never> {
  return new Promise((_resolve, reject) => {
    setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
}

describe('wire-side interrupt reaches the composed runtime', () => {
  let sessionId: string;
  let workspaceId: string;

  beforeEach(async () => {
    setupTestDatabase();
    const seeded = seedWorkspaceWithSession();
    sessionId = seeded.sessionId;
    workspaceId = seeded.workspaceId;

    configureJean2Storage();
    configureJean2RuntimeConfiguration();
    configureJean2WorkspaceToolDiscovery();
    configureJean2Bindings();
    await initializeJean2ExecutionScope();
  });

  afterEach(async () => {
    await disposeJean2ExecutionScope();
    resetJean2ExecutionCompositionFactoryForTests();
    configureStorage(createInMemoryStorageBundle());
    resetTestDatabase();
  });

  test('unscoped execution.interruptSession rejects the composed ask waiter', async () => {
    let sawRequest = (_msg: AskRequestMessage | AskTimedOutMessage) => {};
    const requestSeen = new Promise<void>((resolve) => {
      sawRequest = () => resolve();
    });
    const broadcastFn = (msg: AskRequestMessage | AskTimedOutMessage) => {
      if (msg.type === 'ask.request') sawRequest(msg);
    };

    let askPromise: Promise<unknown> | undefined;
    await withJean2ExecutionScope(async () => {
      const askApi = createAskApi(
        sessionId,
        'call_interrupt_1',
        'question',
        broadcastFn,
        workspaceId,
        sessionId,
      );
      askPromise = askApi({ type: 'confirm', question: 'Proceed?', target: 'human' });
      await requestSeen;
    });

    expect(askPromise).toBeDefined();

    const execution = createJean2SessionExecution();
    // Production path: the WS interrupt handler calls this outside any scope.
    const result = await execution.interruptSession(sessionId, 'user_request');
    expect(result.success).toBe(true);
    expect(result.rejectedAsks.length).toBeGreaterThan(0);

    await expect(
      Promise.race([askPromise!, neverResolves(2000)]),
    ).rejects.toThrow();
  });
});
