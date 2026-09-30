import {
  configureJean2AgentSource,
  configureJean2InstructionSource,
  configureJean2PreconfigSource,
  configureJean2RuntimeConfiguration,
  configureJean2SessionSearchHost,
  configureJean2Storage,
  configureJean2WorkspacePolicy,
  configureJean2WorkspaceToolDiscovery,
} from '@/adapters/capek';
import { configureJean2Bindings } from '@/harnesses/prokop/composition/bindings';
import { disposeJean2ExecutionScope, initializeJean2ExecutionScope } from '@/harnesses/prokop/composition/execution-scope';
import { warmInstalledToolsCache } from '@/adapters/capek/tool-resolver';
import type { Jean2SessionSearchHostDeps } from '@/adapters/capek/session-search';
import { createWiredAgentsApplication } from '@/bootstrap/application';
import type { AgentsApplication } from '@/application/agents';
import { installExecutionLifecyclePort } from '@/application/ports/execution-lifecycle';
import { installBuiltinToolsPort } from '@/application/ports/builtin-tools';
import { builtinTools } from '@/harnesses/prokop/tools';
import { createJean2SessionRepository } from '@/adapters/jean2/session-repository';
import { createSessionSearchQueryRepository } from '@/infrastructure/sqlite/session-search-query-repository';
import { getDatabase } from '@/infrastructure/sqlite/database';
import { getWorkspace } from '@/infrastructure/sqlite/workspaces';

/** S5 session-search host dependencies. The query port is the SQLite
 * infrastructure repository with an injected store accessor; session and
 * workspace lookups come from the existing repository and storage adapter
 * implementations. */
function createSessionSearchHostDeps(agents: AgentsApplication): Jean2SessionSearchHostDeps {
  const sessionRepository = createJean2SessionRepository(agents);
  return {
    // Bootstrap is the composition root: it injects the concrete store
    // accessor; the repository holds no module-global connection state.
    query: createSessionSearchQueryRepository(() => getDatabase()),
    sessions: {
      getSession: (id) => sessionRepository.getSession(id),
      listWorkspaceSessions: (workspaceId) =>
        sessionRepository.listSessionsByWorkspace(workspaceId, { rootOnly: true }),
      listAgentSessions: (agentId, limit) =>
        sessionRepository.listSessionsByAgent(agentId, limit),
    },
    workspaces: {
      getWorkspace,
    },
  };
}

/**
 * Explicit Jean2 server composition root.
 *
 * This module assembles the focused Čapek adapters in the order established by
 * the legacy adapter composition. It owns ordering only; every adapter value,
 * fallback, and policy rule lives in its focused `adapters/capek` module. The
 * session-search host must be configured before the compatibility bindings so
 * the explicit unscoped fallback captures the configured host.
 */
export function createRuntime(existingAgents?: AgentsApplication): AgentsApplication {
  const agents = existingAgents ?? createWiredAgentsApplication();

  // The Prokop harness owns the built-in tools; the catalog adapter reads
  // them through this port instead of importing harness internals.
  installBuiltinToolsPort({ tools: () => builtinTools });

  configureJean2Storage();
  configureJean2RuntimeConfiguration();
  configureJean2WorkspacePolicy();
  configureJean2PreconfigSource(agents);
  configureJean2AgentSource(agents);
  configureJean2InstructionSource();
  configureJean2SessionSearchHost(createSessionSearchHostDeps(agents));
  configureJean2WorkspaceToolDiscovery();
  void warmInstalledToolsCache();
  configureJean2Bindings();
  // S11.4: the harness-owned composed-scope lifecycle installs here; the
  // startup root consumes the application port helpers and imports no
  // harness internals. The initialize result (the composition) is owned by
  // the harness holder; the port exposes lifecycle ordering only.
  installExecutionLifecyclePort({
    initialize: async () => { await initializeJean2ExecutionScope(); },
    dispose: disposeJean2ExecutionScope,
  });
  return agents;
}
