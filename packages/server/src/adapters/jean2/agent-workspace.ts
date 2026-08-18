import type { AgentPreconfigPort, AgentWorkspacePort } from '@/application/ports/agents';
import { getPreconfig } from '@/infrastructure/configuration/preconfig';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '@/infrastructure/sqlite/workspaces';

/**
 * Jean2 adapter for the agent workspace port (S4). Wraps the current
 * workspace store functions exactly; the application use cases own the
 * promotion and home settings policy.
 */
export function createJean2AgentWorkspacePort(): AgentWorkspacePort {
  return {
    create(input) {
      return createWorkspace(input);
    },
    applySettings(id, settings) {
      updateWorkspace(id, { settings });
    },
    delete(id) {
      deleteWorkspace(id);
    },
  };
}

/** Jean2 adapter for the agent preconfig port. */
export function createJean2AgentPreconfigPort(): AgentPreconfigPort {
  return {
    get: getPreconfig,
  };
}
