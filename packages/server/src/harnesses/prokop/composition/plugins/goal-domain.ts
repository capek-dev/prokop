import { serviceKey } from '@/harnesses/prokop/composition/kernel/service-key';
import type { RuntimePlugin, PluginContext } from '@/harnesses/prokop/composition/kernel/types';
import type { Session } from '@prokopai/sdk/types';
import type { RuntimeHost } from '@/infrastructure/runtime/host';
import type { StorageBundle } from '@/infrastructure/storage/contracts';
import type { GoalDomainService } from '@/harnesses/prokop/goals/service';
import { evaluateGoalWithDeps, type GoalEvaluatorDeps } from '@/harnesses/prokop/goals/evaluator';
import { runGoalLoopWithDeps, type GoalLoopDeps } from '@/harnesses/prokop/goals/loop';
import {
  capekOrchestratorSessionKey,
  capekRuntimeHostKey,
  capekStorageKey,
  type OrchestratorSessionContract,
} from '@/harnesses/prokop/composition/plugins/service-keys';

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

export function goalDomainPlugin(id: string): RuntimePlugin<unknown> {
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
