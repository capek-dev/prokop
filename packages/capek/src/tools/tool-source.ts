import { AsyncLocalStorage } from 'node:async_hooks';
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
const scopedToolSource = new AsyncLocalStorage<ToolSourceLifecycle>();

function activeToolSource(): ToolSourceLifecycle {
  return scopedToolSource.getStore() ?? toolSource;
}

export function withToolSource<T>(source: ToolSourceLifecycle, callback: () => T): T {
  return scopedToolSource.run(source, callback);
}

export function configureToolSource(source?: ToolSourceLifecycle): void {
  toolSource = source ?? defaultToolSource;
}

export function getToolSource(): ToolSourceLifecycle {
  return activeToolSource();
}

export async function initializeToolWorkspace(workspacePath: string): Promise<void> {
  await activeToolSource().initializeWorkspace?.(workspacePath);
}

export async function discoverSourceTools(
  workspacePath: string,
  sessionId?: string,
): Promise<Record<string, Tool>> {
  return await activeToolSource().discoverTools?.(workspacePath, sessionId) ?? {};
}
