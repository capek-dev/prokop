import type { Agent, Preconfig } from '@jean2/sdk';

/**
 * Agents domain: promotion and demotion policy.
 *
 * Owns what it means for a preconfig to be an agent and the exact steps of
 * promotion and demotion. The pre-S4 `agents/storage.ts` embedded these
 * rules together with filesystem and workspace store calls; the application
 * use cases now apply these decisions over the directory and workspace
 * ports.
 */

export const PROMOTION_ERRORS = {
  preconfigNotFound: 'Preconfig not found',
  alreadyAgent: 'Already an agent',
  failedToCreate: 'Failed to create agent',
} as const;

/** The promotion layout created on disk: the agent directory with its
 * `skills` and `home/.jean2` subdirectories. */
export interface AgentPromotionLayout {
  agentDir: string;
  skillsDir: string;
  homeDir: string;
  homeDotJean2Dir: string;
}

export function buildPromotionLayout(layout: {
  agentDir: string;
  skillsDir: string;
  homeDir: string;
  homeDotJean2Dir: string;
}): AgentPromotionLayout {
  return { ...layout };
}

/** The agent record shape: the preconfig plus the on-disk home marker and
 * the directory creation time. */
export function buildAgentRecord(
  preconfig: Preconfig,
  hasHome: boolean,
  createdAt: string,
): Agent {
  return {
    ...preconfig,
    hasHome,
    createdAt,
  };
}

/** Demotion removes the home workspace and the whole agent directory; a
 * missing directory is already demoted (no error). */
export function demotionRemovesHomeWorkspace(agentId: string): { homeWorkspaceId: string } {
  return { homeWorkspaceId: `${agentId}-home` };
}
