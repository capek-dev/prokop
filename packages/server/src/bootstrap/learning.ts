import type { AgentsApplication } from '@/application/agents';
import type { Workspace, WorkspaceLearningSettings } from '@prokopai/sdk';
import { createLearningHistoryApi } from '@/application/learning/history-api';
import { broadcastEvent, broadcastSessionUpdated } from '@/transport/websocket/broadcast';
import { createLearningService } from '@/application/learning/service';
import { createLearningReviewRunner, type LearningReviewRunnerDependencies } from '@/application/learning/review-runner';
import { createLearningRecovery } from '@/application/learning/recovery';
import type { LearningRuntimePort } from '@/application/ports/learning-runtime';
import { getHeadlessExecutionPort, type HeadlessSessionRunPort } from '@/application/ports/headless-execution';
import { createProkopSessionRepository } from '@/adapters/prokop/session-repository';
import { getDatabase } from '@/infrastructure/sqlite/database';
import { getWorkspace, listWorkspaces } from '@/infrastructure/sqlite/workspaces';
import { listSessions } from '@/infrastructure/sqlite/session-store';
import { createLearningRepository } from '@/infrastructure/sqlite/learning-repository';
import { createLearningEvidenceReader } from '@/infrastructure/sqlite/learning-evidence';
import { getModelsDocument, getModelRuntimeStatus } from '@/config/models';
import {
  agentHomeLearningSettings,
  parseAgentLearningConfig,
  parseLearningSettings,
} from '@/domains/learning/settings';
import {
  getPreconfigSync,
  preconfigFileMtimeMs,
  updatePreconfig,
} from '@/infrastructure/config/preconfig';

export function createWiredLearning(
  agents: Pick<AgentsApplication, 'getAgentDirectory' | 'getPreconfigOrAgent' | 'isAgentSync'>,
  runtime: LearningRuntimePort,
  overrides: {
    modelAvailable?: (provider: string, model: string) => boolean;
    harnessModelEffort?: (harness: 'codex-cli' | 'claude-cli', model: string, variant: string | null) => Promise<string | null>;
    saveHarnessSelection?: (harness: 'codex-cli' | 'claude-cli', sessionId: string, model: string, effort: string) => void;
    headless?: Pick<HeadlessSessionRunPort, 'run' | 'supportedHarnesses'>;
  } = {},
) {
  const db = getDatabase();
  const repository = createLearningRepository(db);
  const directories = runtime.directories;

  /** Effective learning settings: agent homes resolve from the owning
   * agent's preconfig config (absent = enabled defaults); other workspaces
   * from their stored settings with the workspace-memory dependency. */
  async function learningSettingsFor(workspace: Workspace): Promise<WorkspaceLearningSettings | null> {
    if (workspace.settings.isAgentHome) {
      const agentId = workspace.settings.agentId;
      if (!agentId) return null;
      const preconfig = await agents.getPreconfigOrAgent(agentId);
      const config = parseAgentLearningConfig(preconfig?.settings);
      if (!config?.enabled) return null;
      return agentHomeLearningSettings(config, agentId);
    }
    const learning = parseLearningSettings(workspace.settings.learning);
    if (!learning?.enabled || !workspace.settings.memory?.enabled) return null;
    return learning;
  }

  /** Agent learning sources for the sync evidence reader, cached on the
   * preconfig file mtime so config edits are picked up without re-reading
   * the file on every eligibility check. */
  const agentSourcesCache = new Map<string, { mtimeMs: number; sources: WorkspaceLearningSettings['sources'] }>();
  function agentSourcesFor(agentId: string): WorkspaceLearningSettings['sources'] {
    const mtimeMs = preconfigFileMtimeMs(agentId);
    const cached = agentSourcesCache.get(agentId);
    if (cached && cached.mtimeMs === mtimeMs) return cached.sources;
    const config = parseAgentLearningConfig(getPreconfigSync(agentId)?.settings);
    const sources = config?.sources ?? { mode: 'all' as const };
    agentSourcesCache.set(agentId, { mtimeMs, sources });
    return sources;
  }

  const history = runtime.createHistory({ repository, directories, workspace: getWorkspace, now: Date.now });
  const recoverWorkspace = createLearningRecovery({ repository, reconcile: history.reconcile, now: Date.now,
    onError: error => console.warn('[learning] Recovery preserved current files', error instanceof Error ? error.message : 'Unavailable history destination') });
  const operations = new Map<string, Promise<unknown>>();
  function serialize<T>(workspaceId: string, operation: () => Promise<T>): Promise<T> {
    const previous = operations.get(workspaceId) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    operations.set(workspaceId, next);
    return next.finally(() => { if (operations.get(workspaceId) === next) operations.delete(workspaceId); });
  }
  const sessions = createProkopSessionRepository(agents);
  const reader = (workspace: NonNullable<ReturnType<typeof getWorkspace>>) => createLearningEvidenceReader(db,
    workspace.settings.isAgentHome
      ? { kind: 'agent', agentId: workspace.settings.agentId ?? '', sources: agentSourcesFor(workspace.settings.agentId ?? '') }
      : { kind: 'workspace', workspaceId: workspace.id });
  const executeProkop = runtime.createExecution({
    database: db, repository, directories, workspace: getWorkspace,
    createSession(workspace, preconfigId, runId) {
      return db.transaction(() => {
        const id = crypto.randomUUID();
        sessions.createSession({ id, workspaceId: workspace.id, harness: runtime.harness, preconfigId, title: '[Learning]', status: 'active',
          metadata: { learningRunId: runId }, parentId: null, agentName: null, permissionMode: 'standard' });
        db.run('INSERT INTO learning_session_origins (session_id, run_id) VALUES (?, ?)', [id, runId]);
        return id;
      })();
    },
  });
  /** Harness reviews run as normal headless agent turns with the harness's
   * own tools (prompt-embedded evidence, mounted memory/skill tools). They
   * bind no journal destination, so history records the outcome and sources
   * but no undoable changes. */
  const harnessExecute = async (
    input: Parameters<LearningReviewRunnerDependencies['execute']>[0],
    harness: 'codex-cli' | 'claude-cli',
  ): Promise<{ error?: string }> => {
    const { workspace, reviewer, runId, signal } = input;
    signal.throwIfAborted();
    const headless = overrides.headless ?? getHeadlessExecutionPort();
    if (!headless || !headless.supportedHarnesses().includes(harness)) {
      return { error: `${harness} is unavailable for learning reviews on this host` };
    }
    const model = input.preconfig.model ?? '';
    const sessionId = db.transaction(() => {
      const id = crypto.randomUUID();
      sessions.createSession({ id, workspaceId: workspace.id, harness, preconfigId: reviewer.preconfigId,
        title: '[Learning]', status: 'active', metadata: { learningRunId: runId },
        parentId: null, agentName: null, permissionMode: 'standard' });
      // Belt-and-braces: metadata.learningRunId alone already disqualifies the
      // review session from ever becoming evidence.
      db.run('INSERT INTO learning_session_origins (session_id, run_id) VALUES (?, ?)', [id, runId]);
      return id;
    })();
    // Materialized agent reviewers carry agentId so the harness mounts the
    // agent-scoped tools (codex/claude only do when session.agentId === preconfigId).
    sessions.updateSession(sessionId, {
      agentId: agents.isAgentSync(reviewer.preconfigId) ? reviewer.preconfigId : null,
      selectedModel: model || null,
    });
    if (model && input.reviewEffort) {
      overrides.saveHarnessSelection?.(harness, sessionId, model, input.reviewEffort);
    }
    // The reviewer cannot rely on session_search reaching cross-workspace
    // evidence, so transcripts are embedded (newest first into the budget).
    const evidence = repository.evidence(runId);
    const source = reader(workspace);
    const transcripts: string[] = []
    let omitted = 0;
    let budget = 0;
    for (let index = evidence.length - 1; index >= 0; index--) {
      const item = evidence[index];
      let turn: string;
      try {
        turn = source.readTurn(item.message_id)
          .map(message => `${message.role}: ${message.content}`)
          .join('\n');
      } catch {
        turn = '(transcript unavailable)';
      }
      const block = `### Turn ${item.message_id} (session ${item.session_id}, completed ${new Date(item.completed_at).toISOString()})\n${turn}`;
      if (budget + block.length > 120_000) {
        omitted++;
        continue;
      }
      budget += block.length;
      transcripts.unshift(block);
    }
    const note = omitted > 0 ? `\n\n(${omitted} older evidence transcript(s) omitted to fit the review budget)` : '';
    const prompt = `${input.prompt}\n\nEvidence to review (full transcripts):\n${transcripts.join('\n\n')}${note}`;
    const result = await headless.run({ harness, parentSessionId: sessionId, childSessionId: sessionId,
      preconfig: input.preconfig, prompt, workspacePath: workspace.path, workspaceId: workspace.id,
      modelId: model, providerId: '', resumeFromHistory: false });
    signal.throwIfAborted();
    // Defense in depth: the no-op headless wire swallows pre-turn validation
    // errors, so a dispatch that never ran a turn would otherwise record a
    // green run. A real review always writes an assistant message.
    if (!result.error && !db.query(
      "SELECT 1 FROM messages WHERE session_id = ? AND role = 'assistant' LIMIT 1",
    ).get(sessionId)) {
      return { error: 'Harness review turn did not run' };
    }
    return result;
  };
  const execute: LearningReviewRunnerDependencies['execute'] = async input =>
    (input.reviewHarness === 'prokop' ? executeProkop(input) : harnessExecute(input, input.reviewHarness));
  const runner = createLearningReviewRunner({
    repository, workspace: getWorkspace, learningSettings: learningSettingsFor, preconfig: id => agents.getPreconfigOrAgent(id),
    modelAvailable: overrides.modelAvailable ?? ((provider, model) => getModelRuntimeStatus(provider).usable
      && getModelsDocument().providers.some(p => p.id === provider && p.models.some(m => m.id === model))),
    harnessModelEffort: overrides.harnessModelEffort,
    eligible: (workspace, id) => reader(workspace).eligible(id), execute, now: Date.now,
  });
  const service = createLearningService({
    repository, workspaces: listWorkspaces, learningSettings: learningSettingsFor, now: Date.now,
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
  /** One-time migration: agents whose home workspace still carries learning
   * settings get them copied into the agent preconfig's `settings.learning`
   * (when the agent has no config of its own); stored home settings become
   * inert because every reader now resolves through the agent. */
  async function migrateAgentLearning(): Promise<number> {
    let migrated = 0;
    for (const workspace of listWorkspaces()) {
      if (!workspace.settings.isAgentHome) continue;
      const agentId = workspace.settings.agentId;
      if (!agentId) continue;
      const preconfig = await agents.getPreconfigOrAgent(agentId);
      if (!preconfig) continue;
      const settings = preconfig.settings ? { ...preconfig.settings } : {};
      if (settings.learning !== undefined) continue;
      const legacy = parseLearningSettings(workspace.settings.learning);
      const reviewer = legacy?.reviewers[0];
      settings.learning = {
        enabled: legacy?.enabled ?? true,
        cadence: reviewer?.cadence ?? null,
        instructions: legacy?.instructions ?? reviewer?.instructions ?? '',
        sources: legacy?.sources ?? { mode: 'all' },
      };
      await updatePreconfig(agentId, { settings });
      agentSourcesCache.delete(agentId);
      migrated++;
    }
    return migrated;
  }

  return { ...service, repository, history, reader, api, migrateAgentLearning };
}
