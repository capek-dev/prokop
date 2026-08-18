import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { getRuntimeHost as getJean2CompatibilityBindings } from '@capekai/core/internal/hosts';
import {
  configureJean2Bindings,
  jean2CompatibilityBindings,
} from '@/adapters/capek/bindings';
import { deliverCapekEvent } from '@/adapters/capek/events';
import { jean2DeliveryBindings } from '@/adapters/capek/delivery';
import { jean2InteractionBindings } from '@/adapters/capek/interaction';
import { jean2SandboxBindings } from '@/adapters/capek/sandbox';
import { jean2TitleBindings } from '@/adapters/capek/titles';
import { jean2WorkspaceBindings } from '@/adapters/capek/workspace';
import { generateSessionTitle, hasManualSessionTitle, isDefaultSessionTitle } from '@/core/session-title';
import { isSandboxActive } from '@/sandbox';
import { getPermissionTimeoutMs } from '@/env';
import { getSession } from '@/infrastructure/sqlite/session-store';
import {
  cancelPendingRequestsBySession,
  createPendingAsk,
  expireOldPermissionRequests,
  expirePermissionRequest,
  getPermissionRequestByRequestId,
  listPendingAsksByRootSession,
  listPendingAsksBySession,
  listPendingRequestsByRootSession,
  removePendingAsk,
  removePendingAsksByToolCallId,
  resolvePermissionRequestByRequestId,
} from '@/infrastructure/sqlite/pending-asks';
import { createGrantFromOptions, matchGrant } from '@/infrastructure/sqlite/permissions';
import { getJean2NotificationsApplication } from '@/adapters/jean2/notifications';
import { resetTestDatabase, setupTestDatabase } from '#tests/db';
import { seedSession, seedWorkspace } from '#tests/seed';

describe('Čapek binding group adapters', () => {
  beforeEach(() => {
    setupTestDatabase();
  });

  afterEach(() => {
    resetTestDatabase();
  });

  test('interaction group keeps the exact operations and identities', () => {
    expect(Object.keys(jean2InteractionBindings).sort()).toEqual([
      'createPendingAsk', 'removePendingAsk', 'removePendingAsksByToolCallId',
      'getPermissionRequestByRequestId', 'resolvePermissionRequestByRequestId',
      'expirePermissionRequest', 'expireOldPermissionRequests', 'cancelPendingRequestsBySession',
      'listPendingAsksBySession', 'listPendingAsksByRootSession', 'listPendingRequestsByRootSession',
      'matchGrant', 'createGrantFromOptions', 'getSessionAutoApproveSeverity',
      'getPermissionTimeoutMs', 'notifyPermissionRequired',
    ].sort());

    expect(jean2InteractionBindings.createPendingAsk).toBe(createPendingAsk);
    expect(jean2InteractionBindings.removePendingAsk).toBe(removePendingAsk);
    expect(jean2InteractionBindings.removePendingAsksByToolCallId).toBe(removePendingAsksByToolCallId);
    expect(jean2InteractionBindings.getPermissionRequestByRequestId).toBe(getPermissionRequestByRequestId);
    expect(jean2InteractionBindings.resolvePermissionRequestByRequestId).toBe(resolvePermissionRequestByRequestId);
    expect(jean2InteractionBindings.expirePermissionRequest).toBe(expirePermissionRequest);
    expect(jean2InteractionBindings.expireOldPermissionRequests).toBe(expireOldPermissionRequests);
    expect(jean2InteractionBindings.cancelPendingRequestsBySession).toBe(cancelPendingRequestsBySession);
    expect(jean2InteractionBindings.listPendingAsksBySession).toBe(listPendingAsksBySession);
    expect(jean2InteractionBindings.listPendingAsksByRootSession).toBe(listPendingAsksByRootSession);
    expect(jean2InteractionBindings.listPendingRequestsByRootSession).toBe(listPendingRequestsByRootSession);
    expect(jean2InteractionBindings.matchGrant).toBe(matchGrant);
    expect(jean2InteractionBindings.createGrantFromOptions).toBe(createGrantFromOptions);
    expect(jean2InteractionBindings.getPermissionTimeoutMs).toBe(getPermissionTimeoutMs);
    expect(typeof jean2InteractionBindings.notifyPermissionRequired).toBe('function');
    expect(getJean2NotificationsApplication().notifyPermissionRequired).toBeDefined();
  });

  test('interaction auto-approve severity reads the session record and falls back to undefined', () => {
    seedWorkspace({ id: 'ws1' });
    const withSeverity = seedSession('ws1', { autoApproveSeverity: 'medium' });
    const withoutSeverity = seedSession('ws1');

    expect(jean2InteractionBindings.getSessionAutoApproveSeverity(withSeverity.id)).toBe('medium');
    expect(jean2InteractionBindings.getSessionAutoApproveSeverity(withoutSeverity.id)).toBeUndefined();
    expect(jean2InteractionBindings.getSessionAutoApproveSeverity('missing')).toBeUndefined();
    expect(getSession(withSeverity.id)?.autoApproveSeverity).toBe('medium');
  });

  test('title, sandbox, and delivery groups keep the exact operations', () => {
    expect(Object.keys(jean2TitleBindings).sort()).toEqual(
      ['isDefaultSessionTitle', 'hasManualSessionTitle', 'generateSessionTitle'].sort(),
    );
    expect(jean2TitleBindings.isDefaultSessionTitle).toBe(isDefaultSessionTitle);
    expect(jean2TitleBindings.hasManualSessionTitle).toBe(hasManualSessionTitle);
    expect(jean2TitleBindings.generateSessionTitle).toBe(generateSessionTitle);

    expect(Object.keys(jean2SandboxBindings)).toEqual(['isSandboxActive']);
    expect(jean2SandboxBindings.isSandboxActive).toBe(isSandboxActive);

    expect(Object.keys(jean2DeliveryBindings)).toEqual(['emit']);
    expect(jean2DeliveryBindings.emit).toBe(deliverCapekEvent);
  });

  test('bindings assemble the exact group objects in the original order', () => {
    expect(Object.keys(jean2CompatibilityBindings)).toEqual([
      'interaction', 'delivery', 'titles', 'workspace', 'sandbox',
    ]);
    expect(jean2CompatibilityBindings.interaction).toBe(jean2InteractionBindings);
    expect(jean2CompatibilityBindings.delivery).toBe(jean2DeliveryBindings);
    expect(jean2CompatibilityBindings.titles).toBe(jean2TitleBindings);
    expect(jean2CompatibilityBindings.workspace).toBe(jean2WorkspaceBindings);
    expect(jean2CompatibilityBindings.sandbox).toBe(jean2SandboxBindings);
    expect('store' in jean2CompatibilityBindings).toBe(false);
  });

  // The compat bindings host has no unconfigured reset. Leaving Jean2
  // bindings installed matches the state that setupTestDatabase and the
  // production startup path establish, so this install test does not leak
  // beyond that expected state.
  test('installs the module-level compatibility bindings by identity', () => {
    configureJean2Bindings();
    expect(getJean2CompatibilityBindings()).toBe(jean2CompatibilityBindings);
  });
});
