import { serviceKey } from '../kernel/service-key';
import type { CapekPlugin, PluginContext } from '../kernel/types';
import type { Session } from '@capekai/types';
import type { RuntimeHost } from '../runtime/host';
import type { StorageBundle } from '../storage/contracts';
import type { GoalDomainService } from '../goals/service';
import {
  evaluateGoalWithDeps,
  runGoalLoopWithDeps,
  type GoalEvaluatorDeps,
  type GoalLoopDeps,
} from '../goals';
import {
  capekOrchestratorSessionKey,
  capekRuntimeHostKey,
  capekStorageKey,
  type OrchestratorSessionContract,
} from './service-keys';

/**
 * C5 goal domain plugin. Owns the agent-scoped `capek.goal-domain` service:
 * goal evaluation and the persistent goal loop run directive over the
 * scope-captured storage bundle and the shared `capek.orchestrator-session`
 * contract. No model-facing goal tool exists in the product (goal mode is a
 * client session directive through `handleChat`), so the domain contributes
 * no tool and no context section. Live adoption: `core/chat-handler.ts`
 * resolves this service through `getGoalDomain()`; the unscoped fallback in
 * `goals/service.ts` keeps the module path for uncomposed consumers.
 */

export const CURRENT_GOAL_DOMAIN_PLUGIN_ID = 'current.goal-domain';

export type { GoalDomainService };

export const capekGoalDomainKey = serviceKey<GoalDomainService>(
  'capek.goal-domain',
  'agent',
);

function sessionUpdatedBroadcast(host: RuntimeHost): (session: Session) => void {
  return (session) => {
    const delivery = {
      event: { kind: 'session', action: 'updated', session } as const,
      audience: { scope: 'global' } as const,
    };
    host.delivery.observe?.(delivery);
    host.delivery.emit(delivery);
  };
}

export function goalDomainPlugin(id: string): CapekPlugin<unknown> {
  return {
    id,
    scope: 'agent',
    provides: [capekGoalDomainKey],
    requires: [capekStorageKey, capekOrchestratorSessionKey, capekRuntimeHostKey],
    setup(context: PluginContext) {
      const storage: StorageBundle = context.require(capekStorageKey);
      const orchestrator: OrchestratorSessionContract = context.require(capekOrchestratorSessionKey);
      const host: RuntimeHost = context.require(capekRuntimeHostKey);

      const evaluatorDeps: GoalEvaluatorDeps = {
        listTranscript: (sessionId) => storage.conversation.listMessagesWithParts(sessionId),
        orchestrator,
      };

      const loopDeps: GoalLoopDeps = {
        getSession: (sessionId) => storage.conversation.getSession(sessionId),
        updateSession: (sessionId, updates) => storage.conversation.updateSession(sessionId, updates),
        evaluate: (evaluateOptions) => evaluateGoalWithDeps(evaluateOptions, evaluatorDeps),
        broadcastSessionUpdatedDefault: sessionUpdatedBroadcast(host),
      };

      const service: GoalDomainService = {
        evaluateGoal: (options) => evaluateGoalWithDeps(options, evaluatorDeps),
        runGoalLoop: (options) => runGoalLoopWithDeps(options, loopDeps),
      };

      context.provide(capekGoalDomainKey, service);
    },
  };
}
