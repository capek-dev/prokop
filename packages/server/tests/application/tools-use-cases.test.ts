import { describe, expect, test } from 'bun:test';
import type { LoadedTool, ToolDefinition, ToolEnvVarStatus } from '@jean2/sdk';
import {
  createToolsHttpApplication,
  type ToolsHttpApplication,
} from '@/application/tools';
import type {
  ToolCatalogPort,
  ToolEnvironmentPort,
} from '@/application/ports/tool-distribution';

function makeDefinition(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name: 'demo',
    description: 'Demo tool',
    inputSchema: { type: 'object', properties: {} },
    timeout: 30000,
    ...overrides,
  } as ToolDefinition;
}

function makeEnvVar(overrides: Partial<ToolEnvVarStatus> = {}): ToolEnvVarStatus {
  return {
    key: 'DEMO_KEY',
    configured: false,
    sensitive: false,
    source: 'tool',
    usedBy: ['demo'],
    ...overrides,
  };
}

interface FakeState {
  tools: ToolDefinition[];
  envVars: ToolEnvVarStatus[];
  listFails: boolean;
  envFails: boolean;
  setResult: 'ok' | 'invalid' | 'failed' | 'throw';
  log: string[];
}

function makeState(): FakeState {
  return {
    tools: [makeDefinition()],
    envVars: [makeEnvVar()],
    listFails: false,
    envFails: false,
    setResult: 'ok',
    log: [],
  };
}

function makeApplication(state: FakeState): ToolsHttpApplication {
  const catalog: ToolCatalogPort = {
    listTools: async () => {
      state.log.push('listTools');
      if (state.listFails) throw new Error('scan failed');
      return state.tools;
    },
    getTool: async (name) => {
      state.log.push(`getTool:${name}`);
      return (state.tools.find((tool) => tool.name === name) ?? null) as unknown as LoadedTool | null;
    },
  };

  const environment: ToolEnvironmentPort = {
    listToolEnvVars: async () => {
      state.log.push('listEnv');
      if (state.envFails) return { ok: false, message: 'env read failed' };
      return { ok: true, status: { envVars: state.envVars } };
    },
    setToolEnvVar: async (key, value) => {
      state.log.push(`setEnv:${key}:${value}`);
      if (state.setResult === 'invalid') return { ok: false, kind: 'invalid', message: 'key must be valid' };
      if (state.setResult === 'failed') return { ok: false, kind: 'failed', message: 'write failed' };
      if (state.setResult === 'throw') throw new Error('unexpected');
      return { ok: true, envVar: makeEnvVar({ key, configured: true }) };
    },
  };

  return createToolsHttpApplication({ catalog, environment });
}

describe('tools application use cases', () => {
  test('listTools returns the catalog and falls back to an empty list on failure', async () => {
    const state = makeState();
    const application = makeApplication(state);

    expect(await application.listTools()).toEqual({ kind: 'ok', tools: [makeDefinition()] });

    state.listFails = true;
    expect(await application.listTools()).toEqual({ kind: 'ok', tools: [] });
  });

  test('getTool distinguishes found and missing tools', async () => {
    const state = makeState();
    const application = makeApplication(state);

    expect((await application.getTool('demo')).kind).toBe('ok');
    expect(await application.getTool('missing')).toEqual({ kind: 'missing' });
  });

  test('listEnv maps failures to the failed result', async () => {
    const state = makeState();
    const application = makeApplication(state);

    expect(await application.listEnv()).toEqual({ kind: 'ok', status: { envVars: [makeEnvVar()] } });

    state.envFails = true;
    expect(await application.listEnv()).toEqual({ kind: 'failed', message: 'env read failed' });
  });

  test('setEnv trims the value and maps invalid, failed, and unexpected errors', async () => {
    const state = makeState();
    const application = makeApplication(state);

    const ok = await application.setEnv('DEMO_KEY', '  secret  ');
    expect(ok).toEqual({ kind: 'ok', envVar: expect.objectContaining({ key: 'DEMO_KEY', configured: true }) });
    expect(state.log).toContain('setEnv:DEMO_KEY:secret');

    state.setResult = 'invalid';
    expect(await application.setEnv('X', 'v')).toEqual({ kind: 'invalid', message: 'key must be valid' });

    state.setResult = 'failed';
    expect(await application.setEnv('X', 'v')).toEqual({ kind: 'failed', message: 'write failed' });

    state.setResult = 'throw';
    await expect(application.setEnv('X', 'v')).rejects.toThrow('unexpected');
  });
});
