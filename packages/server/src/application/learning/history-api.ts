import { createHash } from 'node:crypto';
import type { LearningRunDetail, LearningRunSummary, Preconfig, Session, SessionLearningSettings, Workspace, WorkspaceLearningSettings } from '@prokopai/sdk';
import type { LearningRepository, LearningRunRecord } from '@/infrastructure/sqlite/learning-repository';
import { BadRequestError, NotFoundError } from '@/application/http-errors';
import { buildLearningPrompt } from '@/domains/learning/prompt';
import { notifyLearningActivity } from './activity';

export function createLearningHistoryApi(deps: {
  repository: LearningRepository;
  workspace(id: string): Workspace | null;
  preconfig(id: string): Promise<Preconfig | null>;
  eligible(workspace: Workspace, messageId: string): boolean;
  session(id: string): Session | null;
  updateSession(id: string, updates: { metadata: Session['metadata'] }): Session | null;
  sessionChanged(session: Session): void;
  changed(workspaceId: string): void;
  undo(workspaceId: string, runId: string, changeId: string): Promise<string>;
}) {
  const repository = deps.repository;
  const busy = new Set<string>();
  function workspace(id: string): Workspace {
    const result = deps.workspace(id);
    if (!result) throw new NotFoundError('Workspace not found');
    return result;
  }
  function summary(run: LearningRunRecord): LearningRunSummary {
    return { id: run.id, reviewerId: run.reviewer_id, status: run.status, startedAt: run.started_at,
      error: run.error, resolved: repository.isResolved(run.id), recovered: repository.isRecovered(run.id) };
  }
  function detail(workspaceId: string, runId: string): LearningRunDetail {
    const scope = workspace(workspaceId);
    const run = repository.getRun(runId);
    if (!run || run.workspace_id !== workspaceId) throw new NotFoundError('Learning run not found');
    const changes = repository.changes(runId).map(c => ({ id: c.id, path: c.relative_path, before: c.before_content,
      after: c.after_content, status: c.status, undoPending: repository.hasUndoIntent(c.id) }));
    return { run: summary(run), changes,
      sources: repository.sources(runId).filter(e => deps.eligible(scope, e.message_id)).map(e => ({
        sessionId: e.session_id, messageId: e.message_id, title: deps.session(e.session_id)?.title ?? null,
      })),
      revision: createHash('sha256').update(JSON.stringify([run, changes, repository.isResolved(runId)])).digest('hex') };
  }
  return {
    list(workspaceId: string) { workspace(workspaceId); return { runs: repository.listRuns(workspaceId, 100).map(summary), blocked: repository.blocked(workspaceId) }; },
    detail,
    async preview(workspaceId: string, settings: WorkspaceLearningSettings, reviewerId: string) {
      const scope = workspace(workspaceId);
      const reviewer = settings.reviewers.find(r => r.id === reviewerId);
      if (!reviewer) throw new BadRequestError('Reviewer not found');
      const preconfig = await deps.preconfig(reviewer.preconfigId);
      if (!preconfig) throw new BadRequestError('Reviewer preconfig is unavailable');
      return { prompt: `${preconfig.systemPrompt}\n\n${buildLearningPrompt({ scope: scope.settings.isAgentHome ? 'agent' : 'workspace',
        memoryEnabled: true, sessionSearchEnabled: true, improveSkills: settings.improveSkills,
        skillManagementEnabled: scope.settings.skills?.managementEnabled === true, instructions: settings.instructions, reviewerInstructions: reviewer.instructions })}` };
    },
    async undo(workspaceId: string, runId: string, changeId: string) {
      const current = detail(workspaceId, runId);
      if (current.run.resolved) throw new BadRequestError('This run was resolved by keeping current files');
      if (!current.changes.some(c => c.id === changeId)) throw new NotFoundError('Change not found');
      if (busy.has(workspaceId)) throw new BadRequestError('History operation already in progress');
      busy.add(workspaceId);
      try {
        return { result: await deps.undo(workspaceId, runId, changeId) };
      } finally { busy.delete(workspaceId); deps.changed(workspaceId); notifyLearningActivity(); }
    },
    keepCurrent(workspaceId: string, runId: string, revision: string) {
      if (busy.has(workspaceId)) throw new BadRequestError('History operation already in progress');
      const current = detail(workspaceId, runId);
      if (current.revision !== revision) throw new BadRequestError('History changed. Reload before resolving.');
      repository.keepCurrent(runId, Date.now());
      deps.changed(workspaceId); notifyLearningActivity();
      return { success: true };
    },
    exclusion(sessionId: string, learning: SessionLearningSettings) {
      const session = deps.session(sessionId);
      if (!session) throw new NotFoundError('Session not found');
      const updated = deps.updateSession(sessionId, { metadata: { ...session.metadata, learning } });
      if (!updated) throw new NotFoundError('Session not found');
      deps.sessionChanged(updated);
      notifyLearningActivity();
      return { session: updated };
    },
  };
}
