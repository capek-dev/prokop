import { describe, expect, test } from 'bun:test';
import type { Agent, Preconfig } from '@prokopai/sdk';
import {
  configureProkopAgentSource,
  configureProkopPreconfigSource,
  prokopAgentSource,
  prokopInstructionSource,
  prokopPreconfigSource,
} from '@/harnesses/prokop/host/context-sources';
import type { AgentsApplication } from '@/application/agents';
import { getGlobalAgentsPath } from '@/infrastructure/runtime/paths';

function makeAgentsApplication(calls: string[]): AgentsApplication {
  const preconfig = {
    id: 'coder',
    name: 'Coder',
    description: '',
    systemPrompt: 'PROMPT',
    tools: [],
    model: null,
    provider: null,
    variant: null,
    settings: null,
    isDefault: false,
  } as Preconfig;

  return {
    async getAgentDirectory(id) {
      calls.push(`directory:${id}`);
      return `/data/agents/${id}`;
    },
    isAgentSync(id) {
      calls.push(`sync:${id}`);
      return id === 'coder';
    },
    async isAgent() {
      return false;
    },
    async listAgents(): Promise<Agent[]> {
      return [];
    },
    async getAgent() {
      return null;
    },
    async getPreconfigOrAgent(id) {
      calls.push(`preconfig:${id}`);
      return id === preconfig.id ? preconfig : null;
    },
    async ensureAgentMaterialized() {
      return null;
    },
    async ensureAgentsMaterialized() {
      return [];
    },
    async listAgentSkills() {
      return [];
    },
    async promotePreconfig() {
      throw new Error('unused');
    },
    async demoteAgent() {},
    async readAgentMemoryFile(id, filename) {
      calls.push(`memory:${id}:${filename}`);
      return filename === 'USER.md' ? 'USER' : 'MEMORY';
    },
    async writeAgentMemoryFile() {},
    async getAgentMemory() {
      return { user: '', memory: '' };
    },
    async updateAgentMemory() {},
  };
}

describe('Čapek context source adapters', () => {
  test('preconfig source preserves infrastructure operations and delegates agent lookup lazily', async () => {
    const calls: string[] = [];
    const agents = makeAgentsApplication(calls);
    configureProkopPreconfigSource(agents);

    expect(Object.keys(prokopPreconfigSource).sort()).toEqual(
      ['get', 'getDefault', 'getForAgent', 'list', 'listSubagents'].sort(),
    );
    // Infrastructure operations stay delegated (no agents calls yet); the
    // retrieval-tool append (facade semantics for the scoped resolver)
    // applies to the agent-lookup path this test controls.
    expect(calls).toEqual([]);

    const preconfig = await prokopPreconfigSource.getForAgent('coder');
    expect(preconfig).toMatchObject({ id: 'coder', systemPrompt: 'PROMPT' });
    expect(preconfig?.tools).toContain('retrieve-tool-output');
    expect(calls).toEqual(['preconfig:coder']);
  });

  test('agent source preserves its shape and delegates directory and memory access lazily', async () => {
    const calls: string[] = [];
    const agents = makeAgentsApplication(calls);
    configureProkopAgentSource(agents);

    expect(Object.keys(prokopAgentSource).sort()).toEqual(['getDirectory', 'readMemoryFile'].sort());
    expect(calls).toEqual([]);

    expect(await prokopAgentSource.getDirectory('coder')).toBe('/data/agents/coder');
    expect(await prokopAgentSource.readMemoryFile('coder', 'MEMORY.md')).toBe('MEMORY');
    expect(calls).toEqual(['directory:coder', 'memory:coder:MEMORY.md']);
  });

  test('instruction source wraps the exact global path operation', () => {
    expect(Object.keys(prokopInstructionSource)).toEqual(['getGlobalPath']);
    expect(prokopInstructionSource.getGlobalPath).toBe(getGlobalAgentsPath);
  });
});
