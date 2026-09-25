import type { SessionHarness } from '@prokopai/sdk';

export interface HarnessCreatePolicy {
  codexAvailable(): boolean;
  codexWorkspaceAvailable(workspaceId: string): boolean;
  workspaceRoots?: { isAvailable(workspaceId: string, workspaceRootId: string): boolean };
}

export interface HarnessCreateRequest {
  harness?: unknown;
  workspaceId?: string;
  preconfigId?: string | null;
  workspaceRootId?: string;
}

export type HarnessCreateDecision =
  | { ok: true; harness: SessionHarness }
  | { ok: false; code: 'invalid_session' | 'invalid_workspace_root'; message: string };

/** One server-owned creation rule for HTTP and WebSocket intake. No CLI is started here. */
export function checkHarnessCreate(
  input: HarnessCreateRequest,
  policy: HarnessCreatePolicy,
): HarnessCreateDecision {
  if (input.harness !== undefined && input.harness !== 'prokop' && input.harness !== 'codex-cli') {
    return { ok: false, code: 'invalid_session', message: 'Unknown session harness' };
  }
  const harness = input.harness ?? 'prokop';
  if (harness === 'codex-cli' && !policy.codexAvailable()) {
    return { ok: false, code: 'invalid_session', message: 'Codex CLI 0.156.x is unavailable on this host' };
  }
  const workspaceId = input.workspaceId || '';
  if (harness === 'codex-cli' && (input.preconfigId || !policy.codexWorkspaceAvailable(workspaceId))) {
    return { ok: false, code: 'invalid_session',
      message: 'Codex CLI requires a physical workspace and no Prokop agent preset' };
  }
  if (input.workspaceRootId && !policy.workspaceRoots?.isAvailable(workspaceId, input.workspaceRootId)) {
    return { ok: false, code: 'invalid_workspace_root',
      message: 'Selected worktree is not available for this workspace' };
  }
  return { ok: true, harness };
}

export function unknownHarnessError(harness: unknown): string | null {
  return harness === undefined || harness === 'prokop' || harness === 'codex-cli'
    ? null : 'Unknown session harness';
}

export type ProkopFeature = 'queue' | 'agentSelection' | 'modelSelection';

/** These operations use Čapek semantics; other harnesses must opt in deliberately. */
export function prokopFeatureError(harness: unknown, feature: ProkopFeature): string | null {
  if (harness === undefined || harness === 'prokop') return null;
  if (harness !== 'codex-cli') return 'Unknown session harness';
  const messages: Record<ProkopFeature, string> = {
    queue: 'Message queue is not supported for Codex CLI sessions',
    agentSelection: 'Agent selection is not supported for Codex CLI sessions',
    modelSelection: 'Model selection is owned by Codex CLI for this session',
  };
  return messages[feature];
}
