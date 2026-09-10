import { executeMemoryTool, executeSkillManageTool } from '@capekai/core/hosts';
import type { LearningScope } from '@prokopai/sdk';

export interface LearningKnowledgeBoundary {
  scope: LearningScope;
  memoryDirectory: string;
  skillsDirectory: string;
  improveSkills: boolean;
  /** Recheck run lease, settings, and evidence exclusions on every operation. */
  authorize(): Promise<void>;
  /** Host owns serialization, staging, journal, and revision-checked activation.
   * Execute against an isolated staging directory, never the live destination. */
  mutate<T>(kind: 'memory' | 'skills', execute: (stagingDirectory: string) => Promise<T>): Promise<T>;
}

export interface LearningKnowledgeResult {
  success: boolean;
  error?: string;
  result?: unknown;
}

/** Uses public executors, not internal domain payloads or copied persistence logic.
 * Directory selection belongs to the host and cannot be supplied in tool input. */
export function createLearningKnowledgeExecutor(boundary: LearningKnowledgeBoundary): {
  execute(name: string, input: unknown): Promise<LearningKnowledgeResult>;
} {
  const memoryName = boundary.scope === 'agent' ? 'agent_memory' : 'memory';
  const skillsName = boundary.scope === 'agent' ? 'agent_skill_manage' : 'skill_manage';
  return {
    async execute(name, input) {
      await boundary.authorize();
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return { success: false, error: 'Expected an object' };
      }
      const args = input as Record<string, unknown>;
      if (name === memoryName) {
        if (!['list', 'add', 'replace', 'remove'].includes(String(args.action))
          || (args.target !== 'memory' && args.target !== 'user')) {
          return { success: false, error: 'Invalid memory action or target' };
        }
        // Reads use the same validated snapshot as mutations, never unchecked live paths.
        return boundary.mutate('memory', directory => executeMemoryTool(args, directory, 'none'));
      }
      if (name === skillsName && boundary.improveSkills) {
        if (!['list', 'create', 'update', 'patch', 'delete'].includes(String(args.action))) {
          return { success: false, error: 'Invalid skill action' };
        }
        if (args.action !== 'list' && typeof args.name !== 'string') {
          return { success: false, error: 'Skill name is required' };
        }
        const result = await boundary.mutate('skills', directory => executeSkillManageTool(args, directory, 'none'));
        return result.success ? { success: true, result } : { success: false, error: result.error };
      }
      return { success: false, error: 'Tool is not permitted in this learning scope' };
    },
  };
}
