import { describe, test, expect, beforeEach } from 'vitest';
import { useAskStore, type PendingAskRequest } from '@/stores/askStore';
import type { Ask } from '@prokopai/sdk';

const permissionAsk: Ask = { type: 'permission', question: 'Allow read-file?', resource: '/etc/passwd' };
const genericAsk: Ask = { type: 'text', question: 'Continue?', target: 'human' };

function makeRequest(overrides: Partial<PendingAskRequest> = {}): PendingAskRequest {
  return {
    toolCallId: 'tc-1',
    sessionId: 's1',
    toolName: 'read-file',
    ask: permissionAsk,
    requestId: 'req-1',
    ...overrides,
  };
}

describe('askStore', () => {
  beforeEach(() => {
    useAskStore.getState().clearPendingRequests();
    // Clear handlers manually since clearPendingRequests doesn't reset them
    const handlers = useAskStore.getState().handlers;
    for (const key of handlers.keys()) {
      handlers.delete(key);
    }
  });

  describe('initial state', () => {
    test('starts with empty pending requests', () => {
      expect(useAskStore.getState().pendingRequests).toEqual([]);
    });

    test('starts with empty handlers', () => {
      expect(useAskStore.getState().handlers.size).toBe(0);
    });

    test('starts with empty timedOutRequestIds', () => {
      expect(useAskStore.getState().timedOutRequestIds.size).toBe(0);
    });
  });

  describe('addPendingRequest', () => {
    test('adds a request', () => {
      useAskStore.getState().addPendingRequest(makeRequest());
      expect(useAskStore.getState().pendingRequests).toHaveLength(1);
    });

    test('deduplicates permission requests by requestId', () => {
      useAskStore.getState().addPendingRequest(makeRequest({ toolCallId: 'tc-1', requestId: 'req-1' }));
      useAskStore.getState().addPendingRequest(makeRequest({ toolCallId: 'tc-2', requestId: 'req-1' }));
      expect(useAskStore.getState().pendingRequests).toHaveLength(1);
      expect(useAskStore.getState().pendingRequests[0].toolCallId).toBe('tc-2');
    });

    test('deduplicates generic requests by toolCallId', () => {
      useAskStore.getState().addPendingRequest(makeRequest({ ask: genericAsk, toolCallId: 'tc-1' }));
      useAskStore.getState().addPendingRequest(makeRequest({ ask: genericAsk, toolCallId: 'tc-1' }));
      expect(useAskStore.getState().pendingRequests).toHaveLength(1);
    });

    test('allows different toolCallIds for generic requests', () => {
      useAskStore.getState().addPendingRequest(makeRequest({ ask: genericAsk, toolCallId: 'tc-1' }));
      useAskStore.getState().addPendingRequest(makeRequest({ ask: genericAsk, toolCallId: 'tc-2' }));
      expect(useAskStore.getState().pendingRequests).toHaveLength(2);
    });

    test('rejects permission request with timed out requestId', () => {
      useAskStore.getState().removePendingPermissionRequest('req-1');
      useAskStore.getState().addPendingRequest(makeRequest({ requestId: 'req-1' }));
      expect(useAskStore.getState().pendingRequests).toHaveLength(0);
    });
  });

  describe('removePendingRequest', () => {
    test('removes by toolCallId', () => {
      useAskStore.getState().addPendingRequest(makeRequest({ toolCallId: 'tc-1' }));
      useAskStore.getState().removePendingRequest('tc-1');
      expect(useAskStore.getState().pendingRequests).toHaveLength(0);
    });

    test('does nothing if toolCallId not found', () => {
      useAskStore.getState().addPendingRequest(makeRequest({ toolCallId: 'tc-1' }));
      useAskStore.getState().removePendingRequest('tc-unknown');
      expect(useAskStore.getState().pendingRequests).toHaveLength(1);
    });
  });

  describe('removePendingPermissionRequest', () => {
    test('removes by requestId and records timeout', () => {
      useAskStore.getState().addPendingRequest(makeRequest({ requestId: 'req-1' }));
      useAskStore.getState().removePendingPermissionRequest('req-1');
      expect(useAskStore.getState().pendingRequests).toHaveLength(0);
      expect(useAskStore.getState().timedOutRequestIds.has('req-1')).toBe(true);
    });

    test('falls back to toolCallId if requestId not found', () => {
      useAskStore.getState().addPendingRequest(makeRequest({ requestId: 'req-1' }));
      useAskStore.getState().removePendingPermissionRequest('req-unknown', 'tc-1');
      expect(useAskStore.getState().pendingRequests).toHaveLength(0);
    });

    test('records timeout even if request not found', () => {
      useAskStore.getState().removePendingPermissionRequest('req-absent');
      expect(useAskStore.getState().timedOutRequestIds.has('req-absent')).toBe(true);
    });
  });

  describe('replacePendingPermissionRequests', () => {
    test('replaces all permission requests and clears timedOut set', () => {
      useAskStore.getState().addPendingRequest(makeRequest({ requestId: 'req-1' }));
      useAskStore.getState().removePendingPermissionRequest('req-old');

      const newRequests = [
        makeRequest({ toolCallId: 'tc-new', requestId: 'req-new' }),
      ];
      useAskStore.getState().replacePendingPermissionRequests(newRequests);

      expect(useAskStore.getState().pendingRequests).toEqual(newRequests);
      expect(useAskStore.getState().timedOutRequestIds.size).toBe(0);
    });

    test('keeps non-permission requests intact', () => {
      useAskStore.getState().addPendingRequest(makeRequest({ ask: genericAsk, toolCallId: 'tc-gen' }));
      useAskStore.getState().replacePendingPermissionRequests([]);
      expect(useAskStore.getState().pendingRequests).toHaveLength(1);
      expect(useAskStore.getState().pendingRequests[0].ask.type).toBe('text');
    });
  });

  describe('clearPendingRequestsBySessionId', () => {
    test('removes requests matching sessionId', () => {
      useAskStore.getState().addPendingRequest(makeRequest({ sessionId: 's1' }));
      useAskStore.getState().addPendingRequest(makeRequest({ toolCallId: 'tc-2', sessionId: 's2' }));
      useAskStore.getState().clearPendingRequestsBySessionId('s1');
      expect(useAskStore.getState().pendingRequests).toHaveLength(1);
      expect(useAskStore.getState().pendingRequests[0].sessionId).toBe('s2');
    });

    test('removes requests matching originSessionId', () => {
      useAskStore.getState().addPendingRequest(makeRequest({ sessionId: 's1', originSessionId: 'parent-1' }));
      useAskStore.getState().clearPendingRequestsBySessionId('parent-1');
      expect(useAskStore.getState().pendingRequests).toHaveLength(0);
    });
  });

  describe('handlers', () => {
    test('registerHandler adds handler', () => {
      const handler = () => undefined;
      useAskStore.getState().registerHandler('permission', handler);
      expect(useAskStore.getState().getHandlers('permission')).toContain(handler);
    });

    test('unregisterHandler removes handler', () => {
      const handler = () => undefined;
      useAskStore.getState().registerHandler('permission', handler);
      useAskStore.getState().unregisterHandler('permission', handler);
      expect(useAskStore.getState().getHandlers('permission')).not.toContain(handler);
    });

    test('getHandlers returns empty array for unknown target', () => {
      expect(useAskStore.getState().getHandlers('permission')).toEqual([]);
    });

    test('supports multiple handlers per target', () => {
      const h1 = () => undefined;
      const h2 = () => undefined;
      useAskStore.getState().registerHandler('permission', h1);
      useAskStore.getState().registerHandler('permission', h2);
      expect(useAskStore.getState().getHandlers('permission')).toHaveLength(2);
    });
  });
});
