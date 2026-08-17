import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAgent } from '@capekai/core';
import {
  createJean2AgentScope,
  createJean2ProcessScope,
  JEAN2_AGENT_PLUGIN_IDS,
  JEAN2_PROCESS_PLUGIN_IDS,
  JEAN2_PROFILE_ID,
} from '@capekai/core/internal/composition';
import { createStandaloneBindings } from '../src/facade/standalone-bindings';
import { resetSharedProcessScopeForTests } from '../src/plugins/compose';
import { configureRuntimeHost } from '../src/runtime/host';

const roots: string[] = [];

async function workspace(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'capek-c8-profile-'));
  roots.push(path);
  return path;
}

beforeEach(() => {
  configureRuntimeHost(createStandaloneBindings({
    workspace: tmpdir(),
    sandboxActive: false,
    tempRoot: join(tmpdir(), 'capek-c8-profile-host'),
  }));
});

afterEach(async () => {
  await resetSharedProcessScopeForTests();
  for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true });
});

describe('C8 explicit profiles', () => {
  test('Jean2 profile exposes its exact process and agent inventory', async () => {
    const processScope = await createJean2ProcessScope();
    const agentScope = await createJean2AgentScope(processScope);

    expect(JEAN2_PROFILE_ID).toBe('jean2-compatible');
    expect(processScope.snapshot().plugins.map((plugin) => plugin.id).sort()).toEqual(
      [...JEAN2_PROCESS_PLUGIN_IDS].sort(),
    );
    expect(agentScope.snapshot().plugins.map((plugin) => plugin.id).sort()).toEqual(
      [...JEAN2_AGENT_PLUGIN_IDS].sort(),
    );

    await processScope.dispose();
  });

  test('coding remains the facade default and diagnostics expose the composition', async () => {
    const agent = createAgent({
      model: 'openai/gpt-4o-mini',
      workspace: await workspace(),
      sandbox: true,
    });

    const diagnostics = await agent.diagnostics();

    expect(diagnostics.profileId).toBe('coding');
    expect(diagnostics.process.kind).toBe('process');
    expect(diagnostics.agent.kind).toBe('agent');
    expect(diagnostics.agent.tools.filter((tool) => tool.visible)).toHaveLength(11);

    await agent.close();
  });

  test('concurrent minimal and coding agents keep different profile inventories', async () => {
    const [minimal, coding] = await Promise.all([
      Promise.resolve(createAgent({
        model: 'openai/gpt-4o-mini',
        workspace: await workspace(),
        profile: 'minimal',
        sandbox: true,
      })),
      Promise.resolve(createAgent({
        model: 'openai/gpt-4o-mini',
        workspace: await workspace(),
        profile: 'coding',
        sandbox: true,
      })),
    ]);

    const [minimalDiagnostics, codingDiagnostics] = await Promise.all([
      minimal.diagnostics(),
      coding.diagnostics(),
    ]);

    expect(minimalDiagnostics.profileId).toBe('minimal');
    expect(minimalDiagnostics.agent.tools.filter((tool) => tool.visible)).toHaveLength(0);
    expect(codingDiagnostics.profileId).toBe('coding');
    expect(codingDiagnostics.agent.tools.filter((tool) => tool.visible)).toHaveLength(11);

    await Promise.all([minimal.close(), coding.close()]);
  });
});
