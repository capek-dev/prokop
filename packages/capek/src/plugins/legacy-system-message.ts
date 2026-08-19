import type { Preconfig } from '@capekai/types';
import { loadMemoryInstructions } from '../memory';
import { selfDelegationGuidance } from '../subagent/guidance';
import {
  buildWorkspaceSystemPrompt,
  formatInstructions,
  getAgentDirectory,
  loadInstructions,
  readAgentMemoryFile,
} from '../context';
import { getWorkspace } from '../storage/runtime';
import { getHostGuidance } from '../runtime/host-guidance';
import { getHostLayout } from '../runtime/host-layout';
import {
  validateContextAssemblyData,
  type ContextAssembler,
  type ContextAssemblyData,
} from '../context/assembler';
import type { ContextSectionContribution } from '../kernel/types';

/**
 * Fixed system-message builder, byte-frozen as the C3 legacy adapter.
 *
 * C3 replaced this builder with ordered context contributions, but the fixed
 * implementation stays available through `internal/execution` for migration
 * and serves as the reference against which ordered assembly is verified
 * byte-for-byte. The section guidance constants below are shared with the
 * ordered contributions so both paths emit identical bytes.
 */

export interface SystemMessageOptions {
  preconfig: Preconfig;
  workspacePath?: string;
  workspaceId?: string;
  additionalPaths?: string[];
  selfDelegationAvailable?: boolean;
}

/** The fixed builder behind the ContextAssembler contract. Installed as the
 * default assembler so consumers that run outside a composed agent scope
 * (the current Jean2 server path) keep the exact pre-C3 behavior until they
 * adopt the ordered composition. */
export const fixedBuilderContextAssembler: ContextAssembler = {
  id: 'fixed-legacy-adapter',
  build: (data) => buildSystemMessage(data),
};

/** The legacy session-search guidance contribution, kept for facade and
 * legacy compositions that reproduce the fixed builder byte-for-byte. The
 * C5 domain plugin owns this section in the current Jean2 composition;
 * `createContextSectionsPlugin` includes it only when its
 * `includeSessionSearchGuidance` option stays at the legacy default. */
export const legacySessionSearchGuidanceSection: ContextSectionContribution<ContextAssemblyData> = {
  id: 'session-search-guidance',
  phase: 'workspace',
  order: 50,
  provide: async (context) => {
    const data = validateContextAssemblyData(context.data);
    if (!data.workspaceId) return null;
    return (await getWorkspace(data.workspaceId))?.settings?.sessionSearch?.enabled
      ? getHostGuidance().sessionSearch
      : null;
  },
};

export const AGENT_MEMORY_SKILLS_GUIDANCE = `You have personal memory and skills that travel with you across all workspaces.

MEMORY:
- Use "memory" (workspace) for facts about THIS project (repo conventions, build commands, project-specific patterns).
- Use "agent_memory" (personal) for cross-project knowledge: reusable patterns, techniques, pitfalls, and user preferences that apply everywhere.
- Save to agent_memory when: you complete a complex multi-step task, the user corrects your approach, you discover a pattern useful beyond this project, or you debug through errors.

SKILLS:
- Use "skill_manage" for procedures specific to THIS workspace.
- Use "agent_skill_manage" for personal workflows you've refined across projects.

Before saving, use list to check existing entries and avoid duplicates.`;

/** The legacy self-delegation guidance contribution, kept for facade and
 * legacy compositions that reproduce the fixed builder byte-for-byte. The
 * C5 subagent domain plugin owns this section in the current Jean2 and
 * facade compositions; `createContextSectionsPlugin` includes it only when
 * its `includeSelfDelegationGuidance` option stays at the legacy default. */
export const legacySelfDelegationGuidanceSection: ContextSectionContribution<ContextAssemblyData> = {
  id: 'self-delegation',
  phase: 'identity',
  order: 50,
  provide: (context) => {
    const data = validateContextAssemblyData(context.data);
    return data.selfDelegationAvailable ? selfDelegationGuidance(data.preconfig.id) : null;
  },
};

export async function buildSystemMessage(options: SystemMessageOptions): Promise<string> {
  const { preconfig, workspacePath, workspaceId, additionalPaths } = options;

  let systemMessage = preconfig.systemPrompt || '';

  // Inject agent memory layers if this is an agent
  const agentDir = await getAgentDirectory(preconfig.id);
  if (agentDir) {
    const agentUserMemory = await readAgentMemoryFile(preconfig.id, 'USER.md');
    if (agentUserMemory) {
      systemMessage = `<agent_user_preferences>\n${agentUserMemory}\n</agent_user_preferences>\n\n` + systemMessage;
    }
    const agentMemory = await readAgentMemoryFile(preconfig.id, 'MEMORY.md');
    if (agentMemory) {
      systemMessage = `<agent_memory>\n${agentMemory}\n</agent_memory>\n\n` + systemMessage;
    }

    systemMessage = systemMessage + '\n\n' + getHostGuidance().agentMemorySkills;
  }

  if (options.selfDelegationAvailable) {
    systemMessage = systemMessage + '\n\n' + selfDelegationGuidance(preconfig.id);
  }

  // Add instructions (global first, then project)
  const instructions = await loadInstructions(workspacePath);
  const instructionsSection = formatInstructions(instructions);
  if (instructionsSection) {
    systemMessage = systemMessage + '\n\n' + instructionsSection;
  }

  // Add workspace context
  if (workspacePath) {
    const workspaceContext = buildWorkspaceSystemPrompt(workspacePath, additionalPaths);
    systemMessage = systemMessage + '\n\n' + workspaceContext;
  }

  // Add workspace-gated guidance sections
  if (workspaceId) {
    const workspace = await getWorkspace(workspaceId);
    if (workspace?.settings?.memory?.enabled && workspacePath) {
      const memorySection = await loadMemoryInstructions(getHostLayout().workspaceMemoryDir(workspacePath));
      if (memorySection) {
        systemMessage = systemMessage + '\n\n' + memorySection;
      }
      systemMessage = systemMessage + '\n\n' + getHostGuidance().memory;
    }

    if (workspace?.settings?.skills?.managementEnabled) {
      systemMessage = systemMessage + '\n\n' + getHostGuidance().skillManage;
    }

    if (workspace?.settings?.sessionSearch?.enabled) {
      systemMessage = systemMessage + '\n\n' + getHostGuidance().sessionSearch;
    }
  }

  return systemMessage;
}
