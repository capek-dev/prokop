import { join } from 'node:path';
import type { AutoApproveSeverity } from '@capekai/types';
import { PermissionGrant } from '@capekai/tool';
import type {
  PendingAskRecord,
  RuntimeHost,
} from './host';

interface StandaloneHostOptions {
  workspace: string;
  sandboxActive: boolean;
  tempRoot: string;
}

/** The reference headless `RuntimeHost`. In-memory pending-ask bookkeeping,
 * no grant persistence (every permission ask reaches the host every time),
 * no auto-approve, no-op delivery/titles, process env for tool workspaces.
 * Copy this as the starting point for your own host and replace the
 * behavior you care about. */
export function createStandaloneHost(options: StandaloneHostOptions): RuntimeHost {
  const pending = new Map<string, PendingAskRecord>();
  const recordIdByRequest = new Map<string, string>();
  let sequence = 0;

  const records = (): PendingAskRecord[] => [...pending.values()];
  const byRequest = (requestId: string): PendingAskRecord | null => {
    const id = recordIdByRequest.get(requestId);
    return id ? pending.get(id) ?? null : null;
  };

  return {
    interaction: {
      async createPendingAsk(record) {
        const id = `standalone-ask-${++sequence}`;
        pending.set(id, { ...record, id });
        recordIdByRequest.set(record.requestId, id);
        return id;
      },
      async removePendingAsk(id) {
        const record = pending.get(id);
        if (record) recordIdByRequest.delete(record.requestId);
        pending.delete(id);
      },
      async removePendingAsksByToolCallId(toolCallId) {
        for (const record of records()) {
          if (record.toolCallId === toolCallId) {
            pending.delete(record.id);
            recordIdByRequest.delete(record.requestId);
          }
        }
      },
      getPermissionRequestByRequestId: async (requestId) => byRequest(requestId),
      async resolvePermissionRequestByRequestId(requestId, status, resolution) {
        const record = byRequest(requestId);
        if (!record || record.status !== 'pending') return false;
        pending.set(record.id, { ...record, status, resolution, resolvedAt: Date.now() });
        return true;
      },
      async expirePermissionRequest(id) {
        const record = pending.get(id);
        if (!record || record.status !== 'pending') return false;
        pending.set(id, { ...record, status: 'expired', resolvedAt: Date.now() });
        return true;
      },
      async expireOldPermissionRequests(maxAgeMs) {
        const cutoff = Date.now() - maxAgeMs;
        let count = 0;
        for (const record of records()) {
          if (record.status === 'pending' && record.createdAt < cutoff) {
            pending.set(record.id, { ...record, status: 'expired', resolvedAt: Date.now() });
            count += 1;
          }
        }
        return count;
      },
      async cancelPendingRequestsBySession(sessionId) {
        let count = 0;
        for (const record of records()) {
          if (record.sessionId === sessionId && record.status === 'pending') {
            pending.set(record.id, { ...record, status: 'cancelled', resolvedAt: Date.now() });
            count += 1;
          }
        }
        return count;
      },
      listPendingAsksBySession: async (sessionId) => records().filter((record) => record.sessionId === sessionId && record.status === 'pending'),
      listPendingAsksByRootSession: async (rootSessionId) => records().filter((record) => record.rootSessionId === rootSessionId && record.status === 'pending'),
      listPendingRequestsByRootSession: async (rootSessionId) => records().filter((record) => record.rootSessionId === rootSessionId && record.status === 'pending'),
      matchGrant: async () => ({ matched: false, grant: null }),
      createGrantFromOptions: async () => null as PermissionGrant | null,
      getSessionAutoApproveSeverity: async () => undefined as AutoApproveSeverity | undefined,
      getPermissionTimeoutMs: () => 30 * 60 * 1000,
      notifyPermissionRequired: async () => {},
    },
    delivery: {
      emit: () => {},
    },
    titles: {
      isDefaultSessionTitle: () => true,
      hasManualSessionTitle: () => false,
      generateSessionTitle: async () => null,
    },
    workspace: {
      createToolWorkspaceHost({ workspacePath, additionalPaths, sessionId }) {
        return {
          root: workspacePath ?? options.workspace,
          additionalRoots: additionalPaths,
          allowedRoots: [],
          tempDir: join(options.tempRoot, sessionId),
          getEnvironmentValue: (key) => process.env[key],
        };
      },
    },
    sandbox: {
      isSandboxActive: () => options.sandboxActive,
    },
  };
}
