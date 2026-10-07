import {
  configureProkopAgentSource,
  configureProkopInstructionSource,
  configureProkopPreconfigSource,
  configureProkopRuntimeConfiguration,
  configureProkopSessionSearchHost,
  configureProkopStorage,
  configureProkopWorkspacePolicy,
  configureProkopWorkspaceToolDiscovery,
} from '@/harnesses/prokop/host';
import { configureProkopBindings } from '@/harnesses/prokop/composition/bindings';
import { disposeProkopExecutionScope, initializeProkopExecutionScope } from '@/harnesses/prokop/composition/execution-scope';
import { warmInstalledToolsCache } from '@/harnesses/prokop/host/tool-resolver';
import type { ProkopSessionSearchHostDeps } from '@/harnesses/prokop/host/session-search';
import { createWiredAgentsApplication } from '@/bootstrap/application';
import type { AgentsApplication } from '@/application/agents';
import { installExecutionLifecyclePort } from '@/application/ports/execution-lifecycle';
import { installBuiltinToolsPort } from '@/application/ports/builtin-tools';
import { builtinTools } from '@/harnesses/prokop/tools';
import { createProkopSessionRepository } from '@/adapters/prokop/session-repository';
import { createSessionSearchQueryRepository } from '@/infrastructure/sqlite/session-search-query-repository';
import { getDatabase } from '@/infrastructure/sqlite/database';
import { getWorkspace } from '@/infrastructure/sqlite/workspaces';

/** S5 session-search host dependencies. The query port is the SQLite
 * infrastructure repository with an injected store accessor; session and
 * workspace lookups come from the existing repository and storage adapter
 * implementations. */
function createSessionSearchHostDeps(agents: AgentsApplication): ProkopSessionSearchHostDeps {
  const sessionRepository = createProkopSessionRepository(agents);
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
 * fallback, and policy rule lives in its focused `harnesses/prokop/host` module. The
 * session-search host must be configured before the compatibility bindings so
 * the explicit unscoped fallback captures the configured host.
 */
export function createRuntime(existingAgents?: AgentsApplication): AgentsApplication {
  const agents = existingAgents ?? createWiredAgentsApplication();

  // The Prokop harness owns the built-in tools; the catalog adapter reads
  // them through this port instead of importing harness internals.
  installBuiltinToolsPort({ tools: () => builtinTools });

  configureProkopStorage();
  configureProkopRuntimeConfiguration();
  configureProkopWorkspacePolicy();
  configureProkopPreconfigSource(agents);
  configureProkopAgentSource(agents);
  configureProkopInstructionSource();
  configureProkopSessionSearchHost(createSessionSearchHostDeps(agents));
  configureProkopWorkspaceToolDiscovery();
  void warmInstalledToolsCache();
  configureProkopBindings();
  // S11.4: the harness-owned composed-scope lifecycle installs here; the
  // startup root consumes the application port helpers and imports no
  // harness internals. The initialize result (the composition) is owned by
  // the harness holder; the port exposes lifecycle ordering only.
  installExecutionLifecyclePort({
    initialize: async () => { await initializeProkopExecutionScope(); },
    dispose: disposeProkopExecutionScope,
  });
  return agents;
}
