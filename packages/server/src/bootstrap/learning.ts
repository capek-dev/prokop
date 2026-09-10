import type { AgentsApplication } from '@/application/agents';
import { createLearningHistoryApi } from '@/application/learning/history-api';
import { broadcastEvent, broadcastSessionUpdated } from '@/transport/websocket/broadcast';
import { createLearningService } from '@/application/learning/service';
import { createLearningReviewRunner } from '@/application/learning/review-runner';
import { createLearningRecovery } from '@/application/learning/recovery';
import { createLearningExecution, type LearningExecutionDependencies } from '@/adapters/capek/learning-execution';
import { createLearningDirectoryResolver } from '@/adapters/capek/learning-directories';
import { createLearningHistory } from '@/adapters/capek/learning-history';
import { createJean2SessionRepository } from '@/adapters/jean2/session-repository';
import { getDatabase } from '@/infrastructure/sqlite/database';
import { getWorkspace, listWorkspaces } from '@/infrastructure/sqlite/workspaces';
import { listSessions } from '@/infrastructure/sqlite/session-store';
import { createLearningRepository } from '@/infrastructure/sqlite/learning-repository';
import { createLearningEvidenceReader } from '@/infrastructure/sqlite/learning-evidence';
import { getModelsDocument, getModelRuntimeStatus } from '@/config/models';

export function createWiredLearning(
  agents: Pick<AgentsApplication, 'getAgentDirectory' | 'getPreconfigOrAgent' | 'isAgentSync'>,
  overrides: { execute?: LearningExecutionDependencies['execute']; modelAvailable?: (provider: string, model: string) => boolean } = {},
) {
  const db = getDatabase();
  const repository = createLearningRepository(db);
  const directories = createLearningDirectoryResolver(agents);
  const history = createLearningHistory({ repository, directories, workspace: getWorkspace, now: Date.now });
  const recoverWorkspace = createLearningRecovery({ repository, reconcile: history.reconcile, now: Date.now,
    onError: error => console.warn('[learning] Recovery preserved current files', error instanceof Error ? error.message : 'Unavailable history destination') });
  const operations = new Map<string, Promise<unknown>>();
  function serialize<T>(workspaceId: string, operation: () => Promise<T>): Promise<T> {
    const previous = operations.get(workspaceId) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    operations.set(workspaceId, next);
    return next.finally(() => { if (operations.get(workspaceId) === next) operations.delete(workspaceId); });
  }
  const sessions = createJean2SessionRepository(agents);
  const reader = (workspace: NonNullable<ReturnType<typeof getWorkspace>>) => createLearningEvidenceReader(db,
    workspace.settings.isAgentHome
      ? { kind: 'agent', agentId: workspace.settings.agentId ?? '', sources: workspace.settings.learning?.sources ?? { mode: 'all' } }
      : { kind: 'workspace', workspaceId: workspace.id });
  const execute = createLearningExecution({
    database: db, repository, directories, workspace: getWorkspace, execute: overrides.execute,
    createSession(workspace, preconfigId, runId) {
      return db.transaction(() => {
        const id = crypto.randomUUID();
        sessions.createSession({ id, workspaceId: workspace.id, preconfigId, title: '[Learning]', status: 'active',
          metadata: { learningRunId: runId }, parentId: null, agentName: null, autoApproveSeverity: 'off' });
        db.run('INSERT INTO learning_session_origins (session_id, run_id) VALUES (?, ?)', [id, runId]);
        return id;
      })();
    },
  });
  const runner = createLearningReviewRunner({
    repository, workspace: getWorkspace, preconfig: id => agents.getPreconfigOrAgent(id),
    modelAvailable: overrides.modelAvailable ?? ((provider, model) => getModelRuntimeStatus(provider).usable
      && getModelsDocument().providers.some(p => p.id === provider && p.models.some(m => m.id === model))),
    eligible: (workspace, id) => reader(workspace).eligible(id), execute, now: Date.now,
  });
  const service = createLearningService({
    repository, workspaces: listWorkspaces, now: Date.now,
    eligible: (workspace, id) => reader(workspace).eligible(id),
    async discover(workspace, since, signal, reviewerId) {
      const source = reader(workspace);
      const result: Array<{ messageId: string; sessionId: string; completedAt: number }> = [];
      let after = 0;
      for (;;) {
        signal.throwIfAborted();
        const page = source.discover(after, since);
        if (page.scannedThrough === after) return result;
        after = page.scannedThrough;
        for (const item of page.evidence) {
          if (!db.query('SELECT 1 FROM learning_evidence WHERE workspace_id = ? AND reviewer_id = ? AND message_id = ?').get(workspace.id, reviewerId, item.messageId)) result.push(item);
          if (result.length >= 100) return result;
        }
        // Yield between materialized pages, so foreground changes can revoke access.
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
    },
    activity(workspace) {
      const participating = workspace.settings.isAgentHome
        ? new Set(db.query<{ session_id: string }, [string]>('SELECT DISTINCT session_id FROM messages WHERE agent = ?').all(workspace.settings.agentId ?? '').map(row => row.session_id))
        : null;
      const origins = new Set(db.query<{ session_id: string }, []>('SELECT session_id FROM learning_session_origins').all().map(row => row.session_id));
      const relevant = listSessions().filter(session => {
        if (origins.has(session.id)) return false;
        if (session.metadata?.learningRunId || session.metadata?.scheduledJobId) return false;
        return workspace.settings.isAgentHome
          ? session.agentId === workspace.settings.agentId || participating!.has(session.id)
          : session.workspaceId === workspace.id;
      });
      return { running: relevant.some(s => Boolean(s.runningAt) || s.subagentStatus === 'running'),
        lastActivityAt: relevant.reduce((latest, s) => Math.max(latest, Date.parse(s.updatedAt) || 0), 0) };
    },
    async run(workspaceId, reviewerId, signal) {
      return serialize(workspaceId, async () => {
        try { return await runner.run(workspaceId, reviewerId, signal); }
        finally {
          await recoverWorkspace(workspaceId);
          broadcastEvent({ type: 'learning.changed', workspaceId });
        }
      });
    },
    async recover() {
      repository.recover(Date.now());
      for (const workspace of listWorkspaces()) {
        await serialize(workspace.id, () => recoverWorkspace(workspace.id));
      }
    },
    onError: error => console.error('[learning] Coordinator failed', error),
  });
  const api = createLearningHistoryApi({ repository, workspace: getWorkspace, preconfig: id => agents.getPreconfigOrAgent(id),
    eligible: (workspace, id) => reader(workspace).eligible(id), session: sessions.getSession, updateSession: sessions.updateSession,
    sessionChanged: broadcastSessionUpdated, changed: workspaceId => broadcastEvent({ type: 'learning.changed', workspaceId }),
    async undo(workspaceId, runId, changeId) {
      if (repository.activeRun(workspaceId)) throw new Error('A learning review is running. Try undo after it finishes.');
      return serialize(workspaceId, async () => {
        try { return await history.undo(workspaceId, runId, changeId); }
        finally { await recoverWorkspace(workspaceId); }
      });
    } });
  return { ...service, repository, history, reader, api };
}
