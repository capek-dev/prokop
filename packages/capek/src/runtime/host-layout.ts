import os from 'node:os';
import path from 'node:path';
import { getRuntimeHost } from './host';

export interface HostLayout {
  workspaceMemoryDir(workspacePath: string): string;
  workspaceSkillsDir(workspacePath: string): string;
  agentSkillsDir(agentDir: string): string;
  toolOutputTempRoot(): string;
}

function defaultLayout(): HostLayout {
  return {
    workspaceMemoryDir: (workspacePath) => path.join(workspacePath, '.capek'),
    workspaceSkillsDir: (workspacePath) => path.join(workspacePath, '.agents', 'skills'),
    agentSkillsDir: (agentDir) => path.join(agentDir, 'skills'),
    toolOutputTempRoot: () => path.join(os.tmpdir(), 'capek'),
  };
}

export function getHostLayout(): HostLayout {
  return getRuntimeHost().layout ?? defaultLayout();
}
