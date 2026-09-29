import type { Workspace } from '@prokopai/sdk';
import { createKnowledgeJournal, type KnowledgeJournalResult } from '@/application/learning/knowledge-journal';
import { createLearningKnowledgeFiles } from '@/infrastructure/filesystem/learning-knowledge';
import type { LearningRepository } from '@/infrastructure/sqlite/learning-repository';

export interface LearningHistoryDependencies {
  repository: LearningRepository;
  workspace(id: string): Workspace | null;
  directories(workspace: Workspace): Promise<{ memoryDirectory: string; skillsDirectory: string }>;
  now(): number;
}

/** Recovery and user-requested undo do not require learning to remain enabled.
 * They require the original destination, and never use a newly configured path. */
export function createLearningHistory(deps: LearningHistoryDependencies): {
  undo(workspaceId: string, runId: string, changeId: string): Promise<KnowledgeJournalResult>;
  reconcile(workspaceId: string, runId: string, changeId: string): Promise<KnowledgeJournalResult>;
} {
  async function journal(workspaceId: string, runId: string) {
    const binding = deps.repository.destination(runId);
    if (!binding) throw new Error('Learning destination was not recorded; automatic recovery is unavailable');
    async function authorize(): Promise<void> {
      const run = deps.repository.getRun(runId);
      const workspace = deps.workspace(workspaceId);
      if (!run || run.workspace_id !== workspaceId || run.status === 'running' || !workspace
        || workspace.path !== binding!.workspace_path) throw new Error('Learning history destination is unavailable');
      const current = await deps.directories(workspace);
      if (current.memoryDirectory !== binding!.memory_directory || current.skillsDirectory !== binding!.skills_directory) {
        throw new Error('Learning history destination changed');
      }
      // Directory resolution is asynchronous. Recheck host state after it returns.
      const latest = deps.workspace(workspaceId);
      if (!latest || latest.path !== workspace.path || JSON.stringify(latest.settings) !== JSON.stringify(workspace.settings)) {
        throw new Error('Learning history authorization changed');
      }
      if (deps.repository.activeRun(workspaceId)) {
        throw new Error('Stop the learning writer before changing history');
      }
    }
    await authorize();
    const files = createLearningKnowledgeFiles({
      memoryDirectory: binding.memory_directory, skillsDirectory: binding.skills_directory,
      homeDirectory: deps.workspace(workspaceId)?.settings.isAgentHome ? binding.workspace_path : undefined, authorize,
    });
    return createKnowledgeJournal({ repository: deps.repository, files, now: deps.now, authorize });
  }
  return {
    async undo(workspaceId, runId, changeId) {
      return (await journal(workspaceId, runId)).undo(runId, changeId);
    },
    async reconcile(workspaceId, runId, changeId) {
      return (await journal(workspaceId, runId)).reconcile(runId, changeId);
    },
  };
}
