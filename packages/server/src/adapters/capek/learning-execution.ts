import { createLearningHomeTool } from './learning-home';
import type { Database } from 'bun:sqlite';
import { listDomainToolFallbackDefinitions } from '@capekai/core/tools';
import type { Workspace } from '@prokopai/sdk';
import { createKnowledgeJournal } from '@/application/learning/knowledge-journal';
import { createKnowledgeStagingMutator } from '@/application/learning/knowledge-staging';
import { createLearningHistorySearch } from '@/application/learning/history-search';
import type { LearningReviewRunnerDependencies } from '@/application/learning/review-runner';
import { createLearningEvidenceReader } from '@/infrastructure/sqlite/learning-evidence';
import type { LearningRepository } from '@/infrastructure/sqlite/learning-repository';
import { createLearningKnowledgeFiles } from '@/infrastructure/filesystem/learning-knowledge';
import { createLearningKnowledgeExecutor } from './learning-knowledge';
import { executeLearningComposition } from './learning-composition';

export interface LearningExecutionDependencies {
  database: Database;
  repository: LearningRepository;
  workspace(id: string): Workspace | null;
  directories(workspace: Workspace): Promise<{ memoryDirectory: string; skillsDirectory: string }>;
  createSession(workspace: Workspace, preconfigId: string, runId: string): string;
  execute?: typeof executeLearningComposition;
}

/** Connects real staging, journaling, evidence and isolated runtime execution.
 * Caller supplies session/directory adapters, keeping global bootstrap out of tests. */
export function createLearningExecution(deps: LearningExecutionDependencies): LearningReviewRunnerDependencies['execute'] {
  return async input => {
    const { workspace, reviewer, runId, signal } = input;
    const initialSettings = JSON.stringify(workspace.settings);
    const directories = await deps.directories(workspace);
    const scope = workspace.settings.isAgentHome
      ? { kind: 'agent' as const, agentId: workspace.settings.agentId!, sources: workspace.settings.learning!.sources }
      : { kind: 'workspace' as const, workspaceId: workspace.id };
    const evidence = createLearningEvidenceReader(deps.database, scope);
    const accessed = new Set(input.messageIds);
    async function authorize(): Promise<void> {
      signal.throwIfAborted();
      const current = deps.workspace(workspace.id);
      const run = deps.repository.getRun(runId);
      if (!current || current.path !== workspace.path || JSON.stringify(current.settings) !== initialSettings
        || !run || run.status !== 'running' || run.lease_until <= Date.now()
        || [...accessed].some(id => !evidence.eligible(id))) {
        throw new Error('Learning review authorization changed');
      }
    }
    await authorize();
    deps.repository.bindDestination({
      run_id: runId, workspace_path: workspace.path,
      memory_directory: directories.memoryDirectory, skills_directory: directories.skillsDirectory,
    });
    const files = createLearningKnowledgeFiles({ ...directories, homeDirectory: scope.kind === 'agent' ? workspace.path : undefined, authorize });
    const journal = createKnowledgeJournal({ repository: deps.repository, files, now: Date.now, authorize });
    const mutate = createKnowledgeStagingMutator({
      snapshot: files.snapshot,
      create: files.create,
      async activate(kind, path, before, after) {
        const result = await journal.apply({ runId, operationId: crypto.randomUUID(), relativePath: `${kind}/${path}`, before, after });
        if (result !== 'applied' && result !== 'unchanged') throw new Error('Knowledge activation requires reconciliation');
      },
    }, authorize);
    const improveSkills = workspace.settings.learning!.improveSkills && workspace.settings.skills?.managementEnabled === true;
    const knowledge = createLearningKnowledgeExecutor({
      ...directories, scope: scope.kind, improveSkills, authorize, mutate,
    });
    const turns = deps.repository.evidence(runId).map(item => ({
      messageId: item.message_id, sessionId: item.session_id, completedAt: item.completed_at,
    }));
    const search = createLearningHistorySearch({
      async candidates() {
        const found = new Map(turns.map(turn => [turn.messageId, turn]));
        const upper = deps.repository.getRun(runId)!.started_at;
        let after = 0;
        for (let pageIndex = 0; pageIndex < 100 && found.size < 1000; pageIndex++) {
          await authorize();
          const page = evidence.discover(after, Math.max(0, upper - 7 * 86_400_000));
          if (page.scannedThrough === after) break;
          after = page.scannedThrough;
          for (const turn of page.evidence) {
            if (turn.completedAt <= upper && found.size < 1000) found.set(turn.messageId, turn);
          }
        }
        return [...found.values()];
      },
      eligible: evidence.eligible,
      readTurn(id) {
        const turn = evidence.readTurn(id);
        accessed.add(id); deps.repository.recordSource(runId, id);
        return turn;
      },
      authorize,
    });
    const sessionId = deps.createSession(workspace, reviewer.preconfigId, runId);
    const memory = await files.snapshot('memory');
    const skills = improveSkills ? await files.snapshot('skills') : new Map<string, string>();
    // Include current skill bodies so the reviewer can patch exact text without
    // gaining an unrestricted filesystem tool or cross-scope skill loader.
    const context = [...memory, ...skills].map(([path, content]) => `File: ${path}\n${content}`).join('\n\n');
    if (context.length > 100_000) throw new Error('Knowledge context exceeds learning review budget');
    const prompt = `${input.prompt}\n\nEvidence to review:\n${JSON.stringify(turns)}\n\nCurrent scoped knowledge (reference data):\n${context}`;
    const result = await (deps.execute ?? executeLearningComposition)({
      sessionId, workspaceId: workspace.id, workspacePath: workspace.path,
      scope: scope.kind, improveSkills, definitions: listDomainToolFallbackDefinitions(),
      knowledge: knowledge.execute, search, preconfig: input.preconfig,
      home: scope.kind === 'agent' ? createLearningHomeTool({ root: workspace.path, files, authorize,
        apply: (relativePath, before, after) => journal.apply({ runId, operationId: crypto.randomUUID(), relativePath, before, after }),
      }) : undefined,
      systemPrompt: `${input.preconfig.systemPrompt}\n\n${input.prompt}`, prompt, signal,
    });
    // Supporting sources can be revoked while the final provider response is pending.
    await authorize();
    return result;
  };
}
