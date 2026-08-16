import { join } from 'path';
import {
  validateContextAssemblyData,
  type ContextAssembler,
  type ContextAssemblyData,
} from '../context/assembler';
import {
  formatInstructions,
  getAgentDirectory,
  loadInstructions,
  readAgentMemoryFile,
} from '../context/sources';
import { buildWorkspaceSystemPrompt } from '../context/workspace';
import type {
  CapekPlugin,
  ContextBuildContext,
  ContextSectionContribution,
  PluginContext,
  ProvidedContextSection,
} from '../kernel/types';
import { loadMemoryInstructions, MEMORY_GUIDANCE } from '../memory';
import { SKILL_MANAGE_GUIDANCE } from '../skills';
import { SESSION_SEARCH_GUIDANCE } from '../session-search';
import { getWorkspace } from '../storage/runtime';
import { AGENT_MEMORY_SKILLS_GUIDANCE, selfDelegationGuidance } from './legacy-system-message';
import { capekContextAssemblerKey } from './service-keys';

/**
 * C3 ordered context contributions.
 *
 * Registers the exact current system-message sections, wrappers, omission
 * rules, and order as kernel context contributions. Byte parity with the
 * fixed builder is preserved because the guidance constants and section
 * formats are shared with `legacy-system-message`, and the assembler joins
 * provided sections with '\n\n' exactly like the fixed builder's append
 * chain, including the empty-prompt artifact (the system-prompt section
 * always provides a string, even when it is empty).
 *
 * The ordered assembler is bound to its owning scope at composition time
 * through the narrow `PluginContext.buildContext` closure: it never resolves
 * an ambient active scope at build time. Two simultaneous agents never share
 * an assembler view, and a captured assembler keeps building exactly its own
 * scope's sections even while another scope is entered.
 */

type SectionContribution = ContextSectionContribution<ContextAssemblyData>;

/** Every contribution receives assembly options through the typed narrow
 * data path and validates them, so malformed data fails predictably instead
 * of surfacing unsafe property access. */
function requiredData(context: ContextBuildContext<ContextAssemblyData>): ContextAssemblyData {
  return validateContextAssemblyData(context.data);
}

export const CURRENT_CONTEXT_SECTION_IDS = [
  'agent-memory',
  'agent-user-preferences',
  'system-prompt',
  'memory-skills-guidance',
  'self-delegation',
  'instructions',
  'workspace',
  'workspace-memory',
  'memory-guidance',
  'skill-management-guidance',
  'session-search-guidance',
] as const;

const CONTEXT_SECTIONS: readonly SectionContribution[] = [
  {
    id: 'agent-memory',
    phase: 'identity',
    order: 10,
    provide: async (context) => {
      const data = requiredData(context);
      const agentDir = await getAgentDirectory(data.preconfig.id);
      if (!agentDir) return null;
      const memory = await readAgentMemoryFile(data.preconfig.id, 'MEMORY.md');
      return memory ? `<agent_memory>\n${memory}\n</agent_memory>` : null;
    },
  },
  {
    id: 'agent-user-preferences',
    phase: 'identity',
    order: 20,
    provide: async (context) => {
      const data = requiredData(context);
      const agentDir = await getAgentDirectory(data.preconfig.id);
      if (!agentDir) return null;
      const memory = await readAgentMemoryFile(data.preconfig.id, 'USER.md');
      return memory ? `<agent_user_preferences>\n${memory}\n</agent_user_preferences>` : null;
    },
  },
  {
    id: 'system-prompt',
    phase: 'identity',
    order: 30,
    provide: (context) => {
      const data = requiredData(context);
      // Never null: an empty prompt is a real artifact of the fixed builder,
      // and the '\n\n' join must reproduce its exact bytes.
      return data.preconfig.systemPrompt || '';
    },
  },
  {
    id: 'memory-skills-guidance',
    phase: 'identity',
    order: 40,
    provide: async (context) => {
      const data = requiredData(context);
      const agentDir = await getAgentDirectory(data.preconfig.id);
      return agentDir ? AGENT_MEMORY_SKILLS_GUIDANCE : null;
    },
  },
  {
    id: 'self-delegation',
    phase: 'identity',
    order: 50,
    provide: (context) => {
      const data = requiredData(context);
      return data.selfDelegationAvailable ? selfDelegationGuidance(data.preconfig.id) : null;
    },
  },
  {
    id: 'instructions',
    phase: 'instructions',
    order: 10,
    provide: async (context) => {
      const data = requiredData(context);
      const instructions = await loadInstructions(data.workspacePath);
      return formatInstructions(instructions);
    },
  },
  {
    id: 'workspace',
    phase: 'workspace',
    order: 10,
    provide: (context) => {
      const data = requiredData(context);
      return data.workspacePath
        ? buildWorkspaceSystemPrompt(data.workspacePath, data.additionalPaths)
        : null;
    },
  },
  {
    id: 'workspace-memory',
    phase: 'workspace',
    order: 20,
    provide: async (context) => {
      const data = requiredData(context);
      if (!data.workspaceId) return null;
      const workspace = getWorkspace(data.workspaceId);
      if (!workspace?.settings?.memory?.enabled || !data.workspacePath) return null;
      return loadMemoryInstructions(join(data.workspacePath, '.jean2'));
    },
  },
  {
    id: 'memory-guidance',
    phase: 'workspace',
    order: 30,
    provide: (context) => {
      const data = requiredData(context);
      if (!data.workspaceId) return null;
      const workspace = getWorkspace(data.workspaceId);
      return workspace?.settings?.memory?.enabled && data.workspacePath ? MEMORY_GUIDANCE : null;
    },
  },
  {
    id: 'skill-management-guidance',
    phase: 'workspace',
    order: 40,
    provide: (context) => {
      const data = requiredData(context);
      if (!data.workspaceId) return null;
      return getWorkspace(data.workspaceId)?.settings?.skills?.managementEnabled
        ? SKILL_MANAGE_GUIDANCE
        : null;
    },
  },
  {
    id: 'session-search-guidance',
    phase: 'workspace',
    order: 50,
    provide: (context) => {
      const data = requiredData(context);
      if (!data.workspaceId) return null;
      return getWorkspace(data.workspaceId)?.settings?.sessionSearch?.enabled
        ? SESSION_SEARCH_GUIDANCE
        : null;
    },
  },
];

/** Builds the ordered section list for one scope. Captured through
 * `PluginContext.buildContext` at composition time so the assembler stays
 * bound to the scope that owns it. */
export type ContextSectionBuilder = (
  data: ContextAssemblyData,
) => Promise<readonly ProvidedContextSection[]>;

/** The ordered assembler: validates the typed assembly options, asks its
 * bound scope for the deterministic kernel-ordered sections, and joins them
 * with the fixed builder's exact '\n\n' separator. */
export function createOrderedContextAssembler(
  id: string,
  buildSections: ContextSectionBuilder,
): ContextAssembler {
  return {
    id,
    async build(data: ContextAssemblyData): Promise<string> {
      const validated = validateContextAssemblyData(data);
      const sections = await buildSections(validated);
      return sections.map((section) => section.content).join('\n\n');
    },
  };
}

/** One plugin provides the required context-assembler service and registers
 * every current section. Facade and current compositions install it under
 * their own deterministic plugin id, so diagnostics stay unambiguous. */
export function createContextSectionsPlugin(id: string): CapekPlugin<unknown> {
  return {
    id,
    scope: 'agent',
    provides: [capekContextAssemblerKey],
    setup(context: PluginContext) {
      context.provide(
        capekContextAssemblerKey,
        createOrderedContextAssembler(id, (data) => context.buildContext(data)),
      );
      for (const section of CONTEXT_SECTIONS) {
        context.contributeContext(section);
      }
    },
  };
}
