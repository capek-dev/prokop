import { getHostGuidance } from '../runtime/host-guidance';
import { getHostLayout } from '../runtime/host-layout';
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
import {
  buildSkillManageToolDescription,
  buildSkillToolDefinition,
  executeSkillManageTool,
  executeSkillTool,
  skillManageToolDefinition,
} from '../skills';
import type { StorageBundle } from '../storage/contracts';
import { capekStorageKey } from './service-keys';

/**
 * C5 skills domain plugin. Owns the agent-scoped skills service: the
 * workspace `skill` and `skill_manage` tool payloads, the agent
 * `agent_skill_manage` tool payload, and the skill-management-guidance
 * context section. Tool building stays in the core tool builders over the
 * generic contributed-domain-tool seam; the payloads read only the build
 * context the builders capture (workspace path, allowed skills, agent
 * skills directory, permission risk), never module globals. The unscoped
 * fallback installs explicitly, never at module load.
 */

export const CURRENT_SKILLS_DOMAIN_PLUGIN_ID = 'current.skills-domain';
export const SKILL_TOOL_CONTRIBUTION_ID = 'skills.skill';
export const SKILL_TOOL_CONTRIBUTION_ORDER = 660;
export const SKILL_MANAGE_TOOL_CONTRIBUTION_ID = 'skills.skill_manage';
export const SKILL_MANAGE_TOOL_CONTRIBUTION_ORDER = 695;
export const AGENT_SKILL_MANAGE_TOOL_CONTRIBUTION_ID = 'skills.agent_skill_manage';
export const AGENT_SKILL_MANAGE_TOOL_CONTRIBUTION_ORDER = 801;

export interface SkillsDomainService {
  readonly tools: readonly DomainToolPayload[];
}

export const capekSkillsDomainKey = serviceKey<SkillsDomainService>(
  'capek.skills-domain',
  'agent',
);

export function createSkillToolPayload(): DomainToolPayload {
  return {
    name: 'skill',
    description: 'Load a specialized skill that provides domain-specific instructions and workflows.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    display: { summary: '{name}' },
    visualize: (input, result) => {
      const output = (result as { output?: unknown }).output;
      const content = typeof output === 'string' ? output : undefined;
      const title = (result as { title?: unknown }).title;
      if (content && content.length <= 20_000) {
        return {
          type: 'markdown',
          badge: `${(content.length / 1024).toFixed(1)} KB`,
          content: content.slice(0, 20_000),
          title: typeof title === 'string' ? title : String(input.name ?? 'Skill'),
        };
      }
      return {
        type: 'none',
        message: typeof title === 'string' ? title : `Loaded skill: ${String(input.name ?? '')}`,
      };
    },
    resolveDefinition: async (sessionId, options) => {
      const definition = await buildSkillToolDefinition(
        options?.workspacePath as string,
        options?.allowedSkills as string[] | null | undefined,
        sessionId,
        options?.agentSkillsDir as string | undefined,
      );
      if (!definition) return null;
      return { description: definition.description, inputSchema: definition.inputSchema };
    },
    execute: async (input, context) => {
      return executeSkillTool(
        input.name as string,
        context.workspacePath as string,
        context.allowedSkills as string[] | null | undefined,
        context.sessionId,
        context.agentSkillsDir as string | undefined,
      ) as unknown as Record<string, unknown>;
    },
  };
}

export function createSkillManageToolPayload(): DomainToolPayload {
  return {
    name: 'skill_manage',
    description: skillManageToolDefinition.description,
    inputSchema: skillManageToolDefinition.inputSchema,
    display: { summary: '{action} {name}' },
    visualize: (_input, result) => {
      const skills = Array.isArray(result.skills) ? result.skills : undefined;
      if (skills) {
        return {
          type: 'file-list',
          badge: `${skills.length} skill${skills.length === 1 ? '' : 's'}`,
          singularLabel: 'skill',
          pluralLabel: 'skills',
          files: skills.slice(0, 20).map((s) => ({
            path: String((s as { name?: string }).name ?? ''),
            content: (s as { description?: string }).description,
          })),
          total: skills.length,
        };
      }
      return { type: 'none', message: String(result.title ?? 'Skill updated') };
    },
    resolveDefinition: async (_sessionId, options) => {
      const description = await buildSkillManageToolDescription(
        getHostLayout().workspaceSkillsDir(options?.workspacePath as string),
      );
      return { description, inputSchema: skillManageToolDefinition.inputSchema };
    },
    execute: async (input, context) => {
      const risk = (context.permissionRisk ?? 'none') as PermissionRiskLevel;
      const result = await executeSkillManageTool(
        input,
        getHostLayout().workspaceSkillsDir(context.workspacePath as string),
        risk,
        context.ask,
      );
      if (!result.success) {
        return { error: result.error ?? 'Skill management operation failed' };
      }
      return {
        title: result.title,
        action: result.action,
        name: result.name,
        description: result.description,
        path: result.path,
        summary: result.summary,
        skills: result.skills,
      };
    },
  };
}

export function createAgentSkillManageToolPayload(): DomainToolPayload {
  return {
    name: 'agent_skill_manage',
    description: skillManageToolDefinition.description,
    inputSchema: skillManageToolDefinition.inputSchema,
    display: { summary: '{action} {name}' },
    visualize: (_input, result) => {
      const skills = Array.isArray(result.skills) ? result.skills : undefined;
      if (skills) {
        return {
          type: 'file-list',
          badge: `${skills.length} skill${skills.length === 1 ? '' : 's'}`,
          singularLabel: 'skill',
          pluralLabel: 'skills',
          files: skills.slice(0, 20).map((s) => ({
            path: String((s as { name?: string }).name ?? ''),
            content: (s as { description?: string }).description,
          })),
          total: skills.length,
        };
      }
      return { type: 'none', message: String(result.title ?? 'Skill updated') };
    },
    resolveDefinition: async (_sessionId, options) => {
      const description = await buildSkillManageToolDescription(
        getHostLayout().agentSkillsDir(options?.agentDir as string),
      );
      return { description, inputSchema: skillManageToolDefinition.inputSchema };
    },
    execute: async (input, context) => {
      const result = await executeSkillManageTool(
        input,
        getHostLayout().agentSkillsDir(context.agentDir as string),
        'none',
      );
      if (!result.success) {
        return { error: result.error ?? 'Agent skill management failed' };
      }
      return {
        title: result.title,
        action: result.action,
        name: result.name,
        description: result.description,
        path: result.path,
        summary: result.summary,
        skills: result.skills,
      };
    },
  };
}

/** Explicitly installs the unscoped legacy fallbacks. Called by the Jean2
 * compatibility bindings installation (server bootstrap) and by focused
 * tests; no module-load registration exists. */
export function installSkillsToolFallback(): void {
  registerDomainToolFallback('skill', createSkillToolPayload());
  registerDomainToolFallback('skill_manage', createSkillManageToolPayload());
  registerDomainToolFallback('agent_skill_manage', createAgentSkillManageToolPayload());
}

type SkillSectionContribution = ContextSectionContribution<ContextAssemblyData>;

function skillManagementGuidanceSection(storage: StorageBundle): SkillSectionContribution {
  return {
    id: 'skill-management-guidance',
    phase: 'workspace',
    order: 40,
    provide: async (build) => {
      const data = validateContextAssemblyData(build.data);
      if (!data.workspaceId) return null;
      return (await storage.workspaces.get(data.workspaceId))?.settings?.skills?.managementEnabled
        ? getHostGuidance().skillManage
        : null;
    }
  };
}

export function skillsDomainPlugin(id: string): CapekPlugin<unknown> {
  return {
    id,
    scope: 'agent',
    provides: [capekSkillsDomainKey],
    requires: [capekStorageKey],
    setup(context: PluginContext) {
      const storage: StorageBundle = context.require(capekStorageKey);

      const service: SkillsDomainService = {
        tools: [
          createSkillToolPayload(),
          createSkillManageToolPayload(),
          createAgentSkillManageToolPayload(),
        ],
      };

      context.provide(capekSkillsDomainKey, service);
      for (const payload of service.tools) {
        context.contributeTool({
          id: payload.name === 'skill'
            ? SKILL_TOOL_CONTRIBUTION_ID
            : payload.name === 'skill_manage'
              ? SKILL_MANAGE_TOOL_CONTRIBUTION_ID
              : AGENT_SKILL_MANAGE_TOOL_CONTRIBUTION_ID,
          order: payload.name === 'skill'
            ? SKILL_TOOL_CONTRIBUTION_ORDER
            : payload.name === 'skill_manage'
              ? SKILL_MANAGE_TOOL_CONTRIBUTION_ORDER
              : AGENT_SKILL_MANAGE_TOOL_CONTRIBUTION_ORDER,
          definition: {
            name: payload.name,
            description: payload.description,
            inputSchema: payload.inputSchema,
            timeout: payload.name === 'skill' ? 5000 : 10000,
            [DOMAIN_TOOL_PAYLOAD_FIELD]: payload,
          } as KernelToolDefinition,
          requiredCapabilities: [capekSkillsDomainKey],
        });
      }
      context.contributeContext(skillManagementGuidanceSection(storage));
    },
  };
}
