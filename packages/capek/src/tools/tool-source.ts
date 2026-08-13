import type { Tool } from 'ai';

export interface ToolSourceLifecycle {
  initializeWorkspace?(workspacePath: string): Promise<void>;
  discoverTools?(workspacePath: string, sessionId?: string): Promise<Record<string, Tool>>;
}

const defaultToolSource: Required<ToolSourceLifecycle> = {
  async initializeWorkspace(): Promise<void> {},
  async discoverTools(): Promise<Record<string, Tool>> {
    return {};
  },
};

let toolSource: ToolSourceLifecycle = defaultToolSource;

export function configureToolSource(source?: ToolSourceLifecycle): void {
  toolSource = source ?? defaultToolSource;
}

export function getToolSource(): ToolSourceLifecycle {
  return toolSource;
}

export async function initializeToolWorkspace(workspacePath: string): Promise<void> {
  await toolSource.initializeWorkspace?.(workspacePath);
}

export async function discoverSourceTools(
  workspacePath: string,
  sessionId?: string,
): Promise<Record<string, Tool>> {
  return await toolSource.discoverTools?.(workspacePath, sessionId) ?? {};
}
