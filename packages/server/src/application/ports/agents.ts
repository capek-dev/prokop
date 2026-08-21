import type { Preconfig, Workspace, WorkspaceSettings } from '@prokopai/sdk';

/**
 * Ports for the agents domain (S4). The filesystem adapter implements
 * `AgentDirectoryPort`; the Jean2 workspace adapter implements
 * `AgentWorkspacePort`; the preconfig adapter implements
 * `AgentPreconfigPort`. Use cases never touch the filesystem or the
 * workspace store directly.
 */

/** Filesystem access for agent directories and memory files. All paths are
 * supplied by the application from the injected data-directory accessor. */
export interface AgentDirectoryPort {
  exists(path: string): boolean;
  listDirectories(path: string): Promise<string[]>;
  statBirthtimeIso(path: string): Promise<string>;
  makeDirectories(...paths: string[]): Promise<void>;
  removeRecursive(path: string): Promise<void>;
  readFileOrNull(path: string): Promise<string | null>;
  writeFile(path: string, content: string): Promise<void>;
}

/** Workspace store access for the virtual agent home workspace. */
export interface AgentWorkspacePort {
  create(input: {
    id: string;
    name: string;
    path: string;
    isVirtual: boolean;
  }): Workspace;
  applySettings(id: string, settings: WorkspaceSettings): void;
  delete(id: string): void;
}

/** Preconfig lookup used by promotion and agent records. */
export interface AgentPreconfigPort {
  get(id: string): Promise<Preconfig | null>;
}
