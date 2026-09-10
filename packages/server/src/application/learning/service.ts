import type { Workspace } from '@prokopai/sdk';
import type { LearningRepository } from '@/infrastructure/sqlite/learning-repository';
import { defaultLearningCadence, parseLearningSettings } from '@/domains/learning/settings';
import { createLearningCoordinator } from './coordinator';
import { subscribeLearningActivity } from './activity';

export interface LearningServiceDependencies {
  repository: LearningRepository;
  workspaces(): Workspace[];
  discover(workspace: Workspace, since: number, signal: AbortSignal, reviewerId: string): Promise<Array<{ sessionId: string; messageId: string; completedAt: number }>>;
  activity(workspace: Workspace): { lastActivityAt: number; running: boolean };
  eligible(workspace: Workspace, messageId: string): boolean;
  run(workspaceId: string, reviewerId: string, signal: AbortSignal): Promise<boolean>;
  recover(): Promise<void>;
  now(): number;
  onError(error: unknown): void;
}

/** The coordinator owns timers; this service owns configuration and review eligibility. */
export function createLearningService(deps: LearningServiceDependencies) {
  let due: Array<{ workspaceId: string; reviewerId: string }> = [];
  let unsubscribe: (() => void) | null = null;
  let starting: Promise<void> | null = null;
  let stopping: Promise<void> | null = null;
  let generation = 0;
  let activeReview: { workspace: Workspace; controller: AbortController } | null = null;
  const coordinator = createLearningCoordinator({
    now: deps.now, onError: deps.onError,
    setTimer: (callback, delay) => setTimeout(callback, delay), clearTimer: clearTimeout,
    async reconcile(signal) {
      due = [];
      let next: number | null = null;
      for (const workspace of deps.workspaces()) {
        signal.throwIfAborted();
        const learning = parseLearningSettings(workspace.settings.learning);
        if (!learning?.enabled || !workspace.settings.memory?.enabled || !workspace.settings.sessionSearch?.enabled) continue;
        if (deps.repository.blocked(workspace.id)) continue;
        for (const reviewer of learning.reviewers) {
          const state = deps.repository.activate(workspace.id, reviewer.id, deps.now());
          const discovered = await deps.discover(workspace, state.backfill_from, signal, reviewer.id);
          signal.throwIfAborted();
          for (const item of discovered) deps.repository.enqueue(workspace.id, reviewer.id, item.sessionId, item.messageId, item.completedAt);
          const eligible = deps.repository.pending(workspace.id, reviewer.id, 100, id => deps.eligible(workspace, id));
          if (!eligible.length) continue;
          const cadence = reviewer.cadence ?? defaultLearningCadence(workspace.settings.isAgentHome ? 'agent' : 'workspace');
          const activity = deps.activity(workspace);
          const fallback = Math.min(...eligible.map(item => item.completed_at)) + cadence.maximumPendingMinutes * 60_000;
          const idle = activity.running ? Infinity : activity.lastActivityAt + cadence.idleMinutes * 60_000;
          const cooldown = state.last_started_at === null ? 0 : state.last_started_at + cadence.minimumIntervalMinutes * 60_000;
          const deadline = Math.max(cooldown, Math.min(idle, fallback));
          if (deadline <= deps.now()) due.push({ workspaceId: workspace.id, reviewerId: reviewer.id });
          next = next === null ? deadline : Math.min(next, deadline);
        }
      }
      return next;
    },
    async runDue(signal) {
      const item = due.shift();
      const workspace = item && deps.workspaces().find(candidate => candidate.id === item.workspaceId);
      if (item && workspace) {
        const controller = new AbortController();
        activeReview = { workspace: structuredClone(workspace), controller };
        try {
          await deps.run(item.workspaceId, item.reviewerId, AbortSignal.any([signal, controller.signal]));
        } finally {
          activeReview = null;
        }
      }
      return due.length > 0;
    },
  });

  function notifyActivity(): void {
    if (activeReview) {
      const { workspace, controller } = activeReview;
      const current = deps.workspaces().find(candidate => candidate.id === workspace.id);
      const run = deps.repository.activeRun(workspace.id);
      if (!current || current.path !== workspace.path || JSON.stringify(current.settings) !== JSON.stringify(workspace.settings)
        || (run && deps.repository.sources(run.id).some(item => !deps.eligible(current, item.message_id)))) {
        controller.abort(new Error('Learning configuration or evidence eligibility changed'));
      }
    }
    coordinator.notifyActivity();
  }

  return {
    start(): Promise<void> {
      if (stopping) return Promise.reject(new Error('Learning service is stopping'));
      if (starting) return starting;
      if (unsubscribe) return Promise.resolve();
      const expected = ++generation;
      starting = Promise.resolve().then(() => deps.recover()).then(() => {
        if (generation !== expected) return;
        unsubscribe = subscribeLearningActivity(notifyActivity);
        coordinator.start();
      }).finally(() => { starting = null; });
      return starting;
    },
    stop(): Promise<void> {
      if (stopping) return stopping;
      generation++;
      unsubscribe?.(); unsubscribe = null;
      activeReview?.controller.abort();
      const stopCoordinator = coordinator.stop();
      stopping = Promise.allSettled([starting, stopCoordinator]).then(() => {}).finally(() => { stopping = null; });
      return stopping;
    },
    notifyActivity,
  };
}
