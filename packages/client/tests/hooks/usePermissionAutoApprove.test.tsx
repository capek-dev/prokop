import { renderHook } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import type { PermissionRiskLevel, Session } from '@prokopai/sdk';
import type { PendingAskRequest } from '@/stores/askStore';
import { usePermissionAutoApprove } from '@/hooks/usePermissionAutoApprove';
import { useAskStore } from '@/stores/askStore';
import { useSessionStore } from '@/stores/sessionStore';

const originalSessions = useSessionStore.getState().sessions;
afterEach(() => { useSessionStore.setState({ sessions: originalSessions }); });

test('native harness asks use server risk policy, while Prokop client auto-approval remains bounded', () => {
  const codex = { id: 'codex', harness: 'codex-cli', autoApproveSeverity: 'high' } as Session;
  const claude = { id: 'claude', harness: 'claude-cli', autoApproveSeverity: 'high' } as Session;
  const prokop = { id: 'prokop', harness: 'prokop', autoApproveSeverity: 'medium' } as Session;
  useSessionStore.setState({ sessions: [codex, claude, prokop] });
  const { unmount } = renderHook(() => usePermissionAutoApprove());
  try {
    const handler = useAskStore.getState().getHandlers('permission').at(-1)!;
    const request = (risk: PermissionRiskLevel, sessionId = 'prokop', toolName = 'read-file'): PendingAskRequest => ({
      toolCallId: 'call', sessionId, toolName, ask: { type: 'permission', question: 'Approve?', risk },
    });
    expect(handler(request('low', 'codex', 'codex-cli:command'))).toBeUndefined();
    expect(handler(request('low', 'missing', 'codex-cli:command'))).toBeUndefined();
    expect(handler(request('low', 'claude', 'claude-cli:Read'))).toBeUndefined();
    expect(handler(request('low', 'missing', 'claude-cli:Read'))).toBeUndefined();
    expect(handler(request('low'))).toEqual({ type: 'permission', grant: 'once' });
    expect(handler(request('high'))).toBeUndefined();
    expect(handler(request('unknown' as PermissionRiskLevel))).toBeUndefined();
    useSessionStore.setState({ sessions: [codex, { ...prokop, autoApproveSeverity: 'off' }] });
    expect(handler(request('none'))).toBeUndefined();
  } finally { unmount(); }
});
