import {
  configureJean2AgentSource,
  configureJean2Bindings,
  configureJean2InstructionSource,
  configureJean2PreconfigSource,
  configureJean2RuntimeConfiguration,
  configureJean2SchedulerHost,
  configureJean2SessionSearchHost,
  configureJean2Storage,
  configureJean2WorkspaceToolDiscovery,
} from '@/adapters/capek';
import { warmInstalledToolsCache } from '@/adapters/capek/tool-resolver';
import type { Jean2SchedulerHostDeps } from '@/adapters/capek/scheduler';
import type { Jean2SessionSearchHostDeps } from '@/adapters/capek/session-search';
import { createWiredAgentsApplication } from '@/bootstrap/application';
import type { AgentsApplication } from '@/application/agents';
import { createJean2ScheduledJobExecution } from '@/adapters/jean2/scheduled-job-execution';
import { createJean2SessionRepository } from '@/adapters/jean2/session-repository';
import { createScheduledJobRepository } from '@/infrastructure/sqlite/scheduled-job-repository';
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

/** S4/S5 scheduler host dependencies. The repository is the SQLite
 * infrastructure implementation with an injected store accessor; execution
 * delegates to the current runner through the focused Jean2 adapter. */
function createSchedulerHostDeps(): Jean2SchedulerHostDeps {
  return {
    repository: createScheduledJobRepository(() => getDatabase()),
    execution: createJean2ScheduledJobExecution(),
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

  configureJean2Storage();
  configureJean2RuntimeConfiguration();
  configureJean2PreconfigSource(agents);
  configureJean2AgentSource(agents);
  configureJean2InstructionSource();
  configureJean2SessionSearchHost(createSessionSearchHostDeps(agents));
  configureJean2SchedulerHost(createSchedulerHostDeps());
  configureJean2WorkspaceToolDiscovery();
  void warmInstalledToolsCache();
  configureJean2Bindings();
  return agents;
}

export { createJean2RuntimeComposition } from '@/adapters/capek/composition';
