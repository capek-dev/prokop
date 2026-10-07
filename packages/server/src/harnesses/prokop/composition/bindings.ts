import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configureRuntimeHost, type RuntimeHost } from '@/infrastructure/runtime/host';
import { fixedBuilderContextAssembler } from '@/harnesses/prokop/composition/plugins/legacy-system-message';
import { installMemoryToolFallback } from '@/harnesses/prokop/composition/plugins/memory-domain';
import { installSessionSearchToolFallback } from '@/harnesses/prokop/composition/plugins/session-search-domain';
import { installSkillsToolFallback } from '@/harnesses/prokop/composition/plugins/skills-domain';
import { installTaskToolFallback } from '@/harnesses/prokop/composition/plugins/subagent-domain';
import { installWorkflowToolFallback } from '@/harnesses/prokop/composition/plugins/workflow-domain';
import { setDefaultContextAssembler } from '@/harnesses/prokop/context/assembler';
import { resolveWorkspaceMemoryDir } from '@/infrastructure/runtime/workspace-dirs';
import { prokopDeliveryBindings } from '@/harnesses/prokop/host/delivery';
import { prokopInteractionBindings } from '@/harnesses/prokop/host/interaction';
import { prokopSandboxBindings } from '@/harnesses/prokop/host/sandbox';
import { prokopTitleBindings } from '@/harnesses/prokop/host/titles';
import { prokopToolPolicy } from '@/harnesses/prokop/host/tool-policy';
import { prokopWorkspaceBindings } from '@/harnesses/prokop/host/workspace';

export type { RuntimeHost as ProkopCompatibilityBindings } from '@/infrastructure/runtime/host';

export const prokopCompatibilityBindings = {
  interaction: prokopInteractionBindings,
  delivery: prokopDeliveryBindings,
  titles: prokopTitleBindings,
  workspace: prokopWorkspaceBindings,
  toolPolicy: prokopToolPolicy,
  sandbox: prokopSandboxBindings,
  layout: {
    workspaceMemoryDir: (workspacePath: string) => resolveWorkspaceMemoryDir(workspacePath),
    workspaceSkillsDir: (workspacePath: string) => join(workspacePath, '.agents', 'skills'),
    agentSkillsDir: (agentDir: string) => join(agentDir, 'skills'),
    toolOutputTempRoot: () => join(tmpdir(), 'jean2'),
  },
} satisfies RuntimeHost;

export function configureProkopBindings(): void {
  // The unscoped Jean2 fallback keeps the legacy fixed-builder assembler as
  // the process default. Composed execution scopes seed their own ordered
  // assembler through enterAgentScope. The bootstrap owns this installation.
  setDefaultContextAssembler(fixedBuilderContextAssembler);
  configureRuntimeHost(prokopCompatibilityBindings);
  installSessionSearchToolFallback();
  installTaskToolFallback();
  installWorkflowToolFallback();
  installMemoryToolFallback();
  installSkillsToolFallback();
}
