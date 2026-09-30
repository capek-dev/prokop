import { useEffect } from 'react';
import type { AskHandler } from '@/stores/askStore';
import type { AskPermissionResponse, PermissionMode, PermissionRiskLevel } from '@prokopai/sdk';
import { useAskStore } from '@/stores/askStore';
import { useSessionStore } from '@/stores/sessionStore';

const RISK_ORDER: PermissionRiskLevel[] = ['none', 'low', 'medium', 'high', 'critical'];

function isAtOrBelow(risk: PermissionRiskLevel, max: PermissionRiskLevel): boolean {
  const riskIndex = RISK_ORDER.indexOf(risk);
  const maxIndex = RISK_ORDER.indexOf(max);
  return riskIndex !== -1 && maxIndex !== -1 && riskIndex <= maxIndex;
}

/** Permissions v2 slice-2 shim: the ask wire still carries risk levels while
 * the server classifier is reworked (slice 4 maps Findings to modes). */
function severityFromMode(mode: PermissionMode): PermissionRiskLevel {
  return mode === 'full' ? 'high' : mode === 'extended' ? 'medium' : 'low';
}

function getSessionPermissionMode(sessionId: string): PermissionMode {
  const session = useSessionStore.getState().sessions.find((s) => s.id === sessionId);
  return session?.permissionMode ?? 'standard';
}

function createPermissionHandler(): AskHandler {
  return (request) => {
    const ask = request.ask;
    const isPermissionAsk = ('target' in ask && ask.target === 'permission') || ask.type === 'permission';

    if (!isPermissionAsk) return undefined;

    // Native harnesses check the persisted session ceiling on the server.
    // A client with stale session state must not approve their requests.
    const session = useSessionStore.getState().sessions.find((s) => s.id === request.sessionId);
    if (session?.harnessState?.nativeApprovalPrefix
      || request.toolName.startsWith('codex-cli:') || request.toolName.startsWith('claude-cli:')) return undefined;

    // Check the per-session permission mode; there is no ask-everything
    // level anymore, so the floor is 'standard' (= legacy 'low').
    const effectiveMax = severityFromMode(getSessionPermissionMode(request.sessionId));

    // Check risk level
    const risk = ('risk' in ask ? ask.risk : undefined) as PermissionRiskLevel | undefined;
    if (!risk || !isAtOrBelow(risk, effectiveMax)) {
      return undefined;
    }

    // Auto-approve always uses 'once' scope — no grants are persisted
    return { type: 'permission', grant: 'once' } satisfies AskPermissionResponse;
  };
}

export function usePermissionAutoApprove(): void {
  useEffect(() => {
    const handler = createPermissionHandler();
    useAskStore.getState().registerHandler('permission', handler);
    return () => {
      useAskStore.getState().unregisterHandler('permission', handler);
    };
  }, []);
}
