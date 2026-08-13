import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import type { Preconfig } from '@jean2/sdk';

export interface LoadedInstructions {
  global: string | null;
  project: string | null;
}

export interface PreconfigSource {
  get(id: string): Promise<Preconfig | null>;
  getDefault(): Promise<Preconfig | null>;
  getForAgent(id: string): Promise<Preconfig | null>;
  list(): Promise<Preconfig[]>;
  listSubagents(): Promise<Preconfig[]>;
}

export interface AgentSource {
  getDirectory(id: string): Promise<string | null>;
  readMemoryFile(id: string, filename: 'USER.md' | 'MEMORY.md'): Promise<string | null>;
}

export interface InstructionSource {
  getGlobalPath(): string | undefined;
}

const defaultPreconfigs: PreconfigSource = {
  async get() { return null; },
  async getDefault() { return null; },
  async getForAgent() { return null; },
  async list() { return []; },
  async listSubagents() { return []; },
};

const defaultAgents: AgentSource = {
  async getDirectory() { return null; },
  async readMemoryFile() { return null; },
};

let preconfigs = defaultPreconfigs;
let agents = defaultAgents;
let instructions: InstructionSource = { getGlobalPath: () => undefined };

export function configurePreconfigSource(value?: PreconfigSource): void {
  preconfigs = value ?? defaultPreconfigs;
}

export function configureAgentSource(value?: AgentSource): void {
  agents = value ?? defaultAgents;
}

export function configureInstructionSource(value?: InstructionSource): void {
  instructions = value ?? { getGlobalPath: () => undefined };
}

export const getPreconfig = (id: string) => preconfigs.get(id);
export const getDefaultPreconfig = () => preconfigs.getDefault();
export const getPreconfigOrAgent = (id: string) => preconfigs.getForAgent(id);
export const listPreconfigs = () => preconfigs.list();
export const listSubagentPreconfigs = () => preconfigs.listSubagents();
export const getAgentDirectory = (id: string) => agents.getDirectory(id);
export const readAgentMemoryFile = (id: string, filename: 'USER.md' | 'MEMORY.md') => agents.readMemoryFile(id, filename);

async function readTrimmed(path: string | undefined, label: string): Promise<string | null> {
  if (!path || !existsSync(path)) return null;
  try {
    const content = (await readFile(path, 'utf-8')).trim();
    return content || null;
  } catch (error: unknown) {
    console.error(`Failed to read ${label} instructions:`, error);
    return null;
  }
}

export async function loadInstructions(workspacePath?: string): Promise<LoadedInstructions> {
  return {
    global: await readTrimmed(instructions.getGlobalPath(), 'global'),
    project: workspacePath
      ? await readTrimmed(join(workspacePath, 'AGENTS.md'), 'project')
      : null,
  };
}

export function formatInstructions(value: LoadedInstructions): string | null {
  const sections: string[] = [];
  if (value.global) sections.push(`<instructions source="global">\n${value.global}\n</instructions>`);
  if (value.project) sections.push(`<instructions source="project">\n${value.project}\n</instructions>`);
  return sections.length > 0 ? sections.join('\n\n') : null;
}
