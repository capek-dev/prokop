import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  configureRuntimeHost,
  fixedBuilderContextAssembler,
  installMemoryToolFallback,
  installSchedulerToolFallback,
  installSessionSearchToolFallback,
  installSkillsToolFallback,
  installTaskToolFallback,
  installWorkflowToolFallback,
  setDefaultContextAssembler,
  type RuntimeHost,
} from '@capekai/core/hosts';
import { resolveWorkspaceMemoryDir } from '@/infrastructure/runtime/workspace-dirs';
import { jean2DeliveryBindings } from './delivery';
import { jean2InteractionBindings } from './interaction';
import { jean2SandboxBindings } from './sandbox';
import { jean2TitleBindings } from './titles';
import { jean2ToolPolicy } from './tool-policy';
import { jean2WorkspaceBindings } from './workspace';

export type { RuntimeHost as Jean2CompatibilityBindings } from '@capekai/core/hosts';

export const jean2CompatibilityBindings = {
  interaction: jean2InteractionBindings,
  delivery: jean2DeliveryBindings,
  titles: jean2TitleBindings,
  workspace: jean2WorkspaceBindings,
  toolPolicy: jean2ToolPolicy,
  sandbox: jean2SandboxBindings,
  layout: {
    workspaceMemoryDir: (workspacePath: string) => resolveWorkspaceMemoryDir(workspacePath),
    workspaceSkillsDir: (workspacePath: string) => join(workspacePath, '.agents', 'skills'),
    agentSkillsDir: (agentDir: string) => join(agentDir, 'skills'),
    toolOutputTempRoot: () => join(tmpdir(), 'jean2'),
  },
} satisfies RuntimeHost;

export function configureJean2Bindings(): void {
  // The unscoped Jean2 fallback keeps the legacy fixed-builder assembler as
  // the process default. Composed execution scopes seed their own ordered
  // assembler through enterAgentScope. The bootstrap owns this installation.
  setDefaultContextAssembler(fixedBuilderContextAssembler);
  configureRuntimeHost(jean2CompatibilityBindings);
  installSessionSearchToolFallback();
  installSchedulerToolFallback();
  installTaskToolFallback();
  installWorkflowToolFallback();
  installMemoryToolFallback();
  installSkillsToolFallback();
}
