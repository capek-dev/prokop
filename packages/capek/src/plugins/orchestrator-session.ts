import type { CapekPlugin, PluginContext } from '../kernel/types';
import { runOrchestratorSession } from '../workflow/orchestrator-session';
import {
  capekOrchestratorSessionKey,
  type OrchestratorSessionContract,
} from './service-keys';

/**
 * C5 provider for the shared workflow/goals orchestrator model-turn
 * contract (`capek.orchestrator-session`). Wraps the current implementation
 * at `workflow/orchestrator-session.ts` with its exact function identity, so
 * the workflow domain plugin and, next slice, the goals domain plugin
 * consume the same named service without owning workflow code. The provider
 * is a composition bridge; its workflow-domain import is pinned by the
 * `plugins-no-workflow-ownership` boundary rule.
 */
export function orchestratorSessionProviderPlugin(id: string): CapekPlugin<unknown> {
  return {
    id,
    scope: 'agent',
    provides: [capekOrchestratorSessionKey],
    setup(context: PluginContext) {
      const contract: OrchestratorSessionContract = {
        run: runOrchestratorSession,
      };
      context.provide(capekOrchestratorSessionKey, contract);
    },
  };
}
