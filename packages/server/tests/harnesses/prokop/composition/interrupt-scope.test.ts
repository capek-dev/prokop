import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createAskApi } from '@/harnesses/prokop/permission/ask-user-api';
import { configureStorage } from '@/infrastructure/storage/runtime';
import { createInMemoryStorageBundle } from '@/infrastructure/storage/memory';
import type { AskRequestMessage, AskTimedOutMessage } from '@prokopai/sdk';
import { createProkopSessionExecution } from '@/harnesses/prokop/execution';
import { configureProkopBindings } from '@/harnesses/prokop/composition/bindings';
import { configureProkopRuntimeConfiguration } from '@/harnesses/prokop/host/runtime-configuration';
import { configureProkopStorage } from '@/harnesses/prokop/host/storage';
import { configureProkopWorkspaceToolDiscovery } from '@/harnesses/prokop/host/tool-source';
import {
  disposeProkopExecutionScope,
  initializeProkopExecutionScope,
  resetProkopExecutionCompositionFactoryForTests,
  withProkopExecutionScope,
} from '@/harnesses/prokop/composition/execution-scope';
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

    configureProkopStorage();
    configureProkopRuntimeConfiguration();
    configureProkopWorkspaceToolDiscovery();
    configureProkopBindings();
    await initializeProkopExecutionScope();
  });

  afterEach(async () => {
    await disposeProkopExecutionScope();
    resetProkopExecutionCompositionFactoryForTests();
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
    await withProkopExecutionScope(async () => {
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

    const execution = createProkopSessionExecution();
    // Production path: the WS interrupt handler calls this outside any scope.
    const result = await execution.interruptSession(sessionId, 'user_request');
    expect(result.success).toBe(true);
    expect(result.rejectedAsks.length).toBeGreaterThan(0);

    await expect(
      Promise.race([askPromise!, neverResolves(2000)]),
    ).rejects.toThrow();
  });
});
