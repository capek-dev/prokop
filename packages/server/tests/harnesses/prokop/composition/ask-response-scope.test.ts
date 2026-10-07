import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createAskApi } from '@/harnesses/prokop/permission/ask-user-api';
import { requestPermission } from '@/harnesses/prokop/permission/permission-request-manager';
import { configureStorage } from '@/infrastructure/storage/runtime';
import { createInMemoryStorageBundle } from '@/infrastructure/storage/memory';
import type { AskRequestMessage, AskTimedOutMessage, PermissionAsk } from '@prokopai/sdk';
import { prokopAskResolution } from '@/harnesses/prokop/composition/contracts';
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

// Production port implementation (bootstrap installs it); destructured to
// keep the historical call sites below unchanged.
const { resolveAsk, getAuthorityForPendingAsk } = prokopAskResolution;

// ---------------------------------------------------------------------------
// Regression: the WS ask.response handler resolves asks through the contracts
// seam outside any execution context. Since b962b7b, tool execution enters the
// composed Jean2 agent scope, so waiters live in the composed permission
// runtime. An unscoped resolveAsk hit the process-default runtime's empty
// waiter map: the DB record flipped to approved while the tool hung pending.
// These tests enter the composed scope exactly like real execution, then
// resolve through the unscoped production seam.
// ---------------------------------------------------------------------------

function neverResolves(ms: number): Promise<never> {
  return new Promise((_resolve, reject) => {
    setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
}

function makePermissionAsk(): PermissionAsk {
  return {
    type: 'permission',
    question: 'Allow shell command?',
    resource: 'shell-command',
    action: 'execute',
    patterns: ['ls -la ~'],
    allowedScopes: ['once', 'session', 'workspace'],
  };
}

describe('wire-side ask resolution reaches the composed runtime', () => {
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

  test('unscoped contracts.resolveAsk resolves the composed permission waiter', async () => {
    let capturedRequestId: string | undefined;
    let sawRequest = (_msg: AskRequestMessage) => {};
    const requestSeen = new Promise<void>((resolve) => {
      sawRequest = () => resolve();
    });
    const broadcastFn = (msg: AskRequestMessage | AskTimedOutMessage) => {
      if (msg.type === 'ask.request') {
        capturedRequestId = msg.requestId;
        sawRequest(msg);
      }
    };

    let permissionPromise: Promise<unknown> | undefined;
    await withProkopExecutionScope(async () => {
      permissionPromise = requestPermission({
        sessionId,
        workspaceId,
        toolCallId: 'call_composed_1',
        toolName: 'shell',
        ask: makePermissionAsk(),
        broadcastFn,
      });
      await requestSeen;
    });

    expect(capturedRequestId).toBeString();
    expect(permissionPromise).toBeDefined();

    // Production path: the WS handler calls the contracts seam outside any
    // execution scope. Before the fix this returned false and marked the DB
    // record approved while the waiter above never resolved.
    const resolved = await resolveAsk(
      'call_composed_1',
      { type: 'permission', grant: 'once' },
      capturedRequestId,
    );
    expect(resolved).toBe(true);

    const outcome = await Promise.race([permissionPromise!, neverResolves(2000)]);
    expect(outcome).toBe(true);
  });

  test('unscoped contracts lookups resolve generic asks from the composed runtime', async () => {
    let sawRequest = () => {};
    const requestSeen = new Promise<void>((resolve) => {
      sawRequest = () => resolve();
    });
    const broadcastFn = (msg: AskRequestMessage | AskTimedOutMessage) => {
      if (msg.type === 'ask.request') sawRequest();
    };

    let askPromise: Promise<unknown> | undefined;
    await withProkopExecutionScope(async () => {
      const askApi = createAskApi(
        sessionId,
        'call_composed_2',
        'question',
        broadcastFn,
        workspaceId,
        sessionId,
      );
      askPromise = askApi({ type: 'confirm', question: 'Proceed?', target: 'human' });
      await requestSeen;
    });

    expect(askPromise).toBeDefined();

    // Authority lookup happens during reconnect pending-sync, also unscoped.
    const authority = getAuthorityForPendingAsk('call_composed_2');
    expect(authority).toEqual({
      visibilityScope: 'controller_only',
      resolutionMode: 'controller_only',
    });

    const resolved = await resolveAsk('call_composed_2', {
      type: 'confirm',
      confirmed: true,
    });
    expect(resolved).toBe(true);

    const outcome = await Promise.race([
      askPromise!.then((value) => value),
      neverResolves(2000),
    ]);
    expect(outcome).toBe(true);
  });
});
