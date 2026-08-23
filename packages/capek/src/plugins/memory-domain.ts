import type { PermissionRiskLevel } from '@capekai/tool';
import { serviceKey } from '../kernel/service-key';
import type {
  CapekPlugin,
  ContextSectionContribution,
  PluginContext,
  ToolDefinition as KernelToolDefinition,
} from '../kernel/types';
import {
  DOMAIN_TOOL_PAYLOAD_FIELD,
  registerDomainToolFallback,
  type DomainToolPayload,
} from '../runtime/domain-tool-source';
import { validateContextAssemblyData, type ContextAssemblyData } from '../context/assembler';
import type { ContextSources } from '../context/sources';
import {
  executeMemoryTool,
  memoryToolDefinition,
  loadMemoryInstructions,
} from '../memory';
import type { StorageBundle } from '../storage/contracts';
import { getHostGuidance } from '../runtime/host-guidance';
import { getHostLayout } from '../runtime/host-layout';
import { capekContextSourcesKey, capekStorageKey } from './service-keys';

/**
 * C5 memory domain plugin. Owns the agent-scoped memory service: the
 * workspace `memory` tool payload, the agent `agent_memory` tool payload,
 * and the memory context sections (agent-memory, agent-user-preferences,
 * memory-skills-guidance, workspace-memory, memory-guidance). Tool building
 * stays in the core tool builders over the generic contributed-domain-tool
 * seam; the payloads read only the build context the builders capture
 * (workspace path, permission risk, agent directory), never module globals.
 * The unscoped fallback installs explicitly, never at module load.
 */

export const CURRENT_MEMORY_DOMAIN_PLUGIN_ID = 'current.memory-domain';
export const MEMORY_TOOL_CONTRIBUTION_ID = 'memory.memory';
export const MEMORY_TOOL_CONTRIBUTION_ORDER = 665;
export const AGENT_MEMORY_TOOL_CONTRIBUTION_ID = 'memory.agent_memory';
export const AGENT_MEMORY_TOOL_CONTRIBUTION_ORDER = 800;

export interface MemoryDomainService {
  readonly tools: readonly DomainToolPayload[];
}

export const capekMemoryDomainKey = serviceKey<MemoryDomainService>(
  'capek.memory-domain',
  'agent',
);

export function createMemoryToolPayload(): DomainToolPayload {
  return {
    name: memoryToolDefinition.name,
    description: memoryToolDefinition.description,
    inputSchema: memoryToolDefinition.inputSchema,
    display: { summary: '{action} {target}' },
    visualize: (_input, result) => {
      const r = result as { action?: string; target?: string; usage?: { chars?: number; limit?: number }; entries?: string[] };
      if (r.action === 'list') {
        const count = Array.isArray(r.entries) ? r.entries.length : 0;
        const usage = r.usage ? `${r.usage.chars ?? 0}/${r.usage.limit ?? 0} chars` : '';
        return {
          type: 'none',
          badge: [`${count} entr${count === 1 ? 'y' : 'ies'}`, usage].filter(Boolean).join(' · '),
          message: `Memory (${r.target ?? 'memory'})`,
        };
      }
      return { type: 'none', message: String(result.title ?? 'Memory updated') };
    },
    execute: async (input, context) => {
      const workspacePath = context.workspacePath as string;
      const risk = (context.permissionRisk ?? 'none') as PermissionRiskLevel;
      const result = await executeMemoryTool(
        input,
        getHostLayout().workspaceMemoryDir(workspacePath),
        risk,
        context.ask,
      );
      if (!result.success) {
        return {
          error: result.error ?? 'Memory operation failed',
          ...(result.entries ? { entries: result.entries } : {}),
          ...(result.usage ? { usage: result.usage } : {}),
        };
      }
      const r = result.result!;
      return {
        title: r.action === 'list' ? `Memory list (${r.target})` : 'Memory updated',
        ...r,
      };
    },
  };
}

export function createAgentMemoryToolPayload(): DomainToolPayload {
  return {
    name: 'agent_memory',
    description: `Persist YOUR personal knowledge that travels with you across all workspaces.

Use target="user" for cross-workspace user preferences (how this person likes to work).
Use target="memory" for accumulated work knowledge (lessons, patterns, techniques from any project).

This is YOUR personal memory. It is separate from the workspace memory tool.
- Use "memory" (workspace) for project-specific facts about the current codebase.
- Use "agent_memory" (this tool) for cross-project knowledge that applies everywhere.

Actions:
- list: Read current entries and char usage. Requires target only.
- add: Append a new bullet entry. Requires content.
- replace: Find an entry by oldText substring and replace it.
- remove: Find an entry by oldText substring and remove it.

Character limits: user=1500, memory=2500. Keep entries compact.`,
    inputSchema: memoryToolDefinition.inputSchema,
    display: { summary: '{action} {target}' },
    visualize: (_input, result) => {
      const r = result as { action?: string; target?: string; entries?: string[] };
      if (r.action === 'list') {
        const count = Array.isArray(r.entries) ? r.entries.length : 0;
        return {
          type: 'none',
          badge: `${count} entr${count === 1 ? 'y' : 'ies'}`,
          message: `Agent memory (${r.target ?? 'memory'})`,
        };
      }
      return { type: 'none', message: String(result.title ?? 'Agent memory updated') };
    },
    execute: async (input, context) => {
      const result = await executeMemoryTool(input, context.agentDir as string, 'none');
      if (!result.success) {
        return { error: result.error ?? 'Agent memory operation failed' };
      }
      const r = result.result!;
      return {
        title: r.action === 'list' ? `Agent memory list (${r.target})` : 'Agent memory updated',
        ...r,
      };
    },
  };
}

/** Explicitly installs the unscoped legacy fallbacks. Called by the Jean2
 * compatibility bindings installation (server bootstrap) and by focused
 * tests; no module-load registration exists. */
export function installMemoryToolFallback(): void {
  registerDomainToolFallback('memory', createMemoryToolPayload());
  registerDomainToolFallback('agent_memory', createAgentMemoryToolPayload());
}

type MemorySectionContribution = ContextSectionContribution<ContextAssemblyData>;

function agentMemorySections(
  sources: Partial<ContextSources>,
  guidance: string,
): readonly MemorySectionContribution[] {
  return [
    {
      id: 'agent-memory',
      phase: 'identity',
      order: 10,
      provide: async (build) => {
        const data = validateContextAssemblyData(build.data);
        const agentDir = await sources.agents?.getDirectory(data.preconfig.id);
        if (!agentDir) return null;
        const memory = await sources.agents?.readMemoryFile(data.preconfig.id, 'MEMORY.md');
        return memory ? `<agent_memory>\n${memory}\n</agent_memory>` : null;
      },
    },
    {
      id: 'agent-user-preferences',
      phase: 'identity',
      order: 20,
      provide: async (build) => {
        const data = validateContextAssemblyData(build.data);
        const agentDir = await sources.agents?.getDirectory(data.preconfig.id);
        if (!agentDir) return null;
        const memory = await sources.agents?.readMemoryFile(data.preconfig.id, 'USER.md');
        return memory ? `<agent_user_preferences>\n${memory}\n</agent_user_preferences>` : null;
      },
    },
    {
      id: 'memory-skills-guidance',
      phase: 'identity',
      order: 40,
      provide: async (build) => {
        const data = validateContextAssemblyData(build.data);
        const agentDir = await sources.agents?.getDirectory(data.preconfig.id);
        return agentDir ? guidance : null;
      },
    },
  ];
}

function workspaceMemorySections(storage: StorageBundle): readonly MemorySectionContribution[] {
  return [
    {
      id: 'workspace-memory',
      phase: 'workspace',
      order: 20,
      provide: async (build) => {
        const data = validateContextAssemblyData(build.data);
        if (!data.workspaceId) return null;
        const workspace = await storage.workspaces.get(data.workspaceId);
        if (!workspace?.settings?.memory?.enabled || !data.workspacePath) return null;
        return loadMemoryInstructions(getHostLayout().workspaceMemoryDir(data.workspacePath));
      },
    },
    {
      id: 'memory-guidance',
      phase: 'workspace',
      order: 30,
      provide: async (build) => {
        const data = validateContextAssemblyData(build.data);
        if (!data.workspaceId) return null;
        const workspace = await storage.workspaces.get(data.workspaceId);
        return workspace?.settings?.memory?.enabled && data.workspacePath ? getHostGuidance().memory : null;
      },
    },
  ];
}

export function memoryDomainPlugin(id: string): CapekPlugin<unknown> {
  return {
    id,
    scope: 'agent',
    provides: [capekMemoryDomainKey],
    requires: [capekStorageKey, capekContextSourcesKey],
    setup(context: PluginContext) {
      const storage: StorageBundle = context.require(capekStorageKey);
      const sources: Partial<ContextSources> = context.require(capekContextSourcesKey);

      const service: MemoryDomainService = {
        tools: [createMemoryToolPayload(), createAgentMemoryToolPayload()],
      };

      context.provide(capekMemoryDomainKey, service);
      for (const payload of service.tools) {
        context.contributeTool({
          id: payload.name === 'memory'
            ? MEMORY_TOOL_CONTRIBUTION_ID
            : AGENT_MEMORY_TOOL_CONTRIBUTION_ID,
          order: payload.name === 'memory'
            ? MEMORY_TOOL_CONTRIBUTION_ORDER
            : AGENT_MEMORY_TOOL_CONTRIBUTION_ORDER,
          definition: {
            name: payload.name,
            description: payload.description,
            inputSchema: payload.inputSchema,
            timeout: 10000,
            [DOMAIN_TOOL_PAYLOAD_FIELD]: payload,
          } as KernelToolDefinition,
          requiredCapabilities: [capekMemoryDomainKey],
        });
      }
      for (const section of agentMemorySections(sources, getHostGuidance().agentMemorySkills)) {
        context.contributeContext(section);
      }
      for (const section of workspaceMemorySections(storage)) {
        context.contributeContext(section);
      }
    },
  };
}
