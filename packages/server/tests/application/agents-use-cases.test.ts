import { describe, expect, test } from 'bun:test';
import type { Preconfig, Workspace, WorkspaceSettings } from '@prokopai/sdk';
import { createAgentsApplication, type AgentsApplication } from '@/application/agents';
import type {
  AgentDirectoryPort,
  AgentPreconfigPort,
  AgentWorkspacePort,
} from '@/application/ports/agents';
import { agentHomeWorkspaceSettings, agentHomeWorkspaceId } from '@/domains/agents';

interface FakeState {
  files: Map<string, string>;
  dirs: Set<string>;
  workspaces: Map<string, { id: string; name: string; path: string; isVirtual: boolean; settings: WorkspaceSettings }>;
  preconfigs: Map<string, Preconfig>;
  log: string[];
}

function makeDirectory(state: FakeState): AgentDirectoryPort {
  const parentDirs = (path: string): string[] => {
    const parts = path.split('/').filter(Boolean);
    const parents: string[] = [];
    for (let i = 1; i <= parts.length; i++) {
      parents.push('/' + parts.slice(0, i).join('/'));
    }
    return parents;
  };
  return {
    exists(path) {
      return state.dirs.has(path) || state.files.has(path);
    },
    async listDirectories(path) {
      state.log.push(`listDirectories:${path}`);
      const prefix = path.endsWith('/') ? path : `${path}/`;
      return [...state.dirs]
        .filter((dir) => dir.startsWith(prefix))
        .map((dir) => dir.slice(prefix.length).split('/')[0])
        .filter((entry, index, all) => entry !== '' && all.indexOf(entry) === index);
    },
    async statBirthtimeIso(path) {
      state.log.push(`stat:${path}`);
      return '2026-08-16T00:00:00.000Z';
    },
    async makeDirectories(...paths) {
      for (const path of paths) {
        for (const parent of parentDirs(path)) {
          state.dirs.add(parent);
        }
        state.dirs.add(path);
        state.log.push(`mkdir:${path}`);
      }
    },
    async removeRecursive(path) {
      state.log.push(`rm:${path}`);
      for (const dir of [...state.dirs]) {
        if (dir === path || dir.startsWith(`${path}/`)) state.dirs.delete(dir);
      }
      for (const file of [...state.files.keys()]) {
        if (file.startsWith(`${path}/`)) state.files.delete(file);
      }
    },
    async readFileOrNull(path) {
      state.log.push(`read:${path}`);
      return state.files.get(path) ?? null;
    },
    async writeFile(path, content) {
      state.log.push(`write:${path}`);
      state.files.set(path, content);
    },
  };
}

function makeWorkspaces(state: FakeState): AgentWorkspacePort {
  return {
    create(input) {
      state.log.push(`createWorkspace:${input.id}`);
      const workspace = {
        ...input,
        settings: {},
      };
      state.workspaces.set(input.id, workspace);
      return workspace as unknown as Workspace;
    },
    applySettings(id, settings) {
      state.log.push(`applySettings:${id}`);
      const existing = state.workspaces.get(id);
      if (existing) {
        existing.settings = { ...existing.settings, ...settings };
      }
    },
    delete(id) {
      state.log.push(`deleteWorkspace:${id}`);
      state.workspaces.delete(id);
    },
  };
}

function makePreconfigs(state: FakeState): AgentPreconfigPort {
  return {
    async get(id) {
      return state.preconfigs.get(id) ?? null;
    },
  };
}

function makeFakes(): FakeState {
  const state: FakeState = {
    files: new Map(),
    dirs: new Set(),
    workspaces: new Map(),
    preconfigs: new Map(),
    log: [],
  };
  return state;
}

function makeApplication(state: FakeState, dataDir = '/data'): AgentsApplication {
  return createAgentsApplication({
    dataDir: () => dataDir,
    directory: makeDirectory(state),
    workspaces: makeWorkspaces(state),
    preconfigs: makePreconfigs(state),
  });
}

function makePreconfig(overrides: Partial<Preconfig> = {}): Preconfig {
  return {
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
    ...overrides,
  } as Preconfig;
}

describe('agents application use cases', () => {
  test('getAgentDirectory returns the directory only when it exists', async () => {
    const state = makeFakes();
    const application = makeApplication(state);

    expect(await application.getAgentDirectory('coder')).toBeNull();

    state.dirs.add('/data/agents/coder');
    expect(await application.getAgentDirectory('coder')).toBe('/data/agents/coder');
  });

  test('isAgentSync and isAgent reflect directory existence', async () => {
    const state = makeFakes();
    const application = makeApplication(state);

    expect(application.isAgentSync('coder')).toBe(false);
    expect(await application.isAgent('coder')).toBe(false);

    state.dirs.add('/data/agents/coder');
    expect(application.isAgentSync('coder')).toBe(true);
    expect(await application.isAgent('coder')).toBe(true);
  });

  test('listAgents returns only directories with a valid preconfig', async () => {
    const state = makeFakes();
    state.dirs.add('/data/agents');
    state.dirs.add('/data/agents/coder');
    state.dirs.add('/data/agents/ghost');
    state.dirs.add('/data/agents/coder/home');
    state.preconfigs.set('coder', makePreconfig());
    const application = makeApplication(state);

    const agents = await application.listAgents();
    expect(agents.map((agent) => agent.id)).toEqual(['coder']);
    expect(agents[0].hasHome).toBe(true);
    expect(agents[0].createdAt).toBe('2026-08-16T00:00:00.000Z');
    expect(agents[0].systemPrompt).toBe('PROMPT');
  });

  test('getAgent returns null without a directory or without a preconfig', async () => {
    const state = makeFakes();
    state.dirs.add('/data/agents/coder');
    const application = makeApplication(state);

    expect(await application.getAgent('coder')).toBeNull();
    state.preconfigs.set('coder', makePreconfig());
    expect((await application.getAgent('coder'))?.id).toBe('coder');
  });

  test('promotePreconfig creates the exact layout, the home workspace with the exact settings, and the agent record', async () => {
    const state = makeFakes();
    state.preconfigs.set('coder', makePreconfig());
    const application = makeApplication(state);

    const agent = await application.promotePreconfig('coder');

    expect(agent.id).toBe('coder');
    expect(agent.hasHome).toBe(true);
    expect(state.dirs.has('/data/agents/coder/skills')).toBe(true);
    expect(state.dirs.has('/data/agents/coder/home/.prokopai')).toBe(true);
    expect(state.workspaces.get('coder-home')).toMatchObject({
      id: 'coder-home',
      name: 'coder-home',
      path: '/data/agents/coder/home',
      isVirtual: true,
    });
    expect(state.workspaces.get('coder-home')!.settings).toEqual(agentHomeWorkspaceSettings('coder'));
  });

  test('promotePreconfig throws the exact pre-S4 errors', async () => {
    const state = makeFakes();
    const application = makeApplication(state);

    await expect(application.promotePreconfig('missing')).rejects.toThrow('Preconfig not found');

    state.preconfigs.set('coder', makePreconfig());
    state.dirs.add('/data/agents/coder');
    await expect(application.promotePreconfig('coder')).rejects.toThrow('Already an agent');
  });

  test('demoteAgent removes the home workspace and the directory, and noops when absent', async () => {
    const state = makeFakes();
    state.dirs.add('/data/agents/coder');
    state.dirs.add('/data/agents/coder/home');
    state.workspaces.set('coder-home', { id: 'coder-home', name: 'coder-home', path: '/data/agents/coder/home', isVirtual: true, settings: {} });
    const application = makeApplication(state);

    await application.demoteAgent('coder');

    expect(state.workspaces.has('coder-home')).toBe(false);
    expect(state.dirs.has('/data/agents/coder')).toBe(false);
    expect(state.log).toContain(`deleteWorkspace:${agentHomeWorkspaceId('coder')}`);

    await application.demoteAgent('never-existed');
    expect(state.log.filter((entry) => entry.startsWith('rm:'))).toHaveLength(1);
  });

  test('memory use cases read, write, and default the exact files', async () => {
    const state = makeFakes();
    state.dirs.add('/data/agents/coder');
    const application = makeApplication(state);

    expect(await application.getAgentMemory('coder')).toEqual({ user: '', memory: '' });
    expect(await application.readAgentMemoryFile('coder', 'USER.md')).toBeNull();

    await application.updateAgentMemory('coder', 'user', '- pref');
    await application.updateAgentMemory('coder', 'memory', '- lesson');
    expect(state.files.get('/data/agents/coder/USER.md')).toBe('- pref');
    expect(state.files.get('/data/agents/coder/MEMORY.md')).toBe('- lesson');
    expect(await application.getAgentMemory('coder')).toEqual({ user: '- pref', memory: '- lesson' });
  });

  test('writeAgentMemoryFile creates the agent directory when missing', async () => {
    const state = makeFakes();
    const application = makeApplication(state);

    await application.writeAgentMemoryFile('fresh', 'USER.md', 'content');
    expect(state.dirs.has('/data/agents/fresh')).toBe(true);
    expect(state.files.get('/data/agents/fresh/USER.md')).toBe('content');
  });
});
