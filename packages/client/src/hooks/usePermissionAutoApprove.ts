import { useEffect } from 'react';
import type { AskHandler } from '@/stores/askStore';
import type { AskPermissionResponse, PermissionRiskLevel } from '@prokopai/sdk';
import { useAskStore } from '@/stores/askStore';
import { useSessionStore } from '@/stores/sessionStore';

const RISK_ORDER: PermissionRiskLevel[] = ['none', 'low', 'medium', 'high', 'critical'];

function isAtOrBelow(risk: PermissionRiskLevel, max: PermissionRiskLevel): boolean {
  return RISK_ORDER.indexOf(risk) <= RISK_ORDER.indexOf(max);
}

function getSessionAutoApproveSeverity(sessionId: string): PermissionRiskLevel | 'off' | null {
  const session = useSessionStore.getState().sessions.find((s) => s.id === sessionId);
  return session?.autoApproveSeverity ?? null;
}

function createPermissionHandler(): AskHandler {
  return (request) => {
    const ask = request.ask;
    const isPermissionAsk = ('target' in ask && ask.target === 'permission') || ask.type === 'permission';

    if (!isPermissionAsk) return undefined;

    // Check the per-session auto-approve severity setting
    const maxSeverity = getSessionAutoApproveSeverity(request.sessionId);

    // If no session setting, default to 'low' (backward compatible)
    // If explicitly 'off', skip auto-approve entirely
    if (maxSeverity === 'off') return undefined;
    const effectiveMax = maxSeverity ?? 'low';

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
