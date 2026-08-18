import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { setupTestDataDir, resetTestDataDir } from '#tests/test-dir';
import { createAgentsApplication } from '@/application/agents';
import {
  createJean2AgentPreconfigPort,
  createJean2AgentWorkspacePort,
} from '@/adapters/jean2';
import { createAgentDirectoryPort } from '@/infrastructure/agents/agent-directory-filesystem';
import { agentHomeWorkspaceSettings } from '@/domains/agents';
import { getWorkspace } from '@/infrastructure/sqlite/workspaces';
import { getDataDir } from '@/paths';

describe('jean2 agents adapters over the real store and filesystem', () => {
  beforeEach(() => {
    setupTestDatabase();
    setupTestDataDir();
  });

  afterEach(() => {
    resetTestDatabase();
    resetTestDataDir();
  });

  test('promote creates the real home workspace with the exact settings and demote removes it', async () => {
    const dataDir = getDataDir();
    const preconfigsDir = join(dataDir, 'preconfigs');
    await mkdir(preconfigsDir, { recursive: true });
    await writeFile(
      join(preconfigsDir, 'coder.md'),
      '---\nid: coder\nname: Coder\ndescription: Writes code\nmode: both\n---\nBe concise.\n',
    );

    const application = createAgentsApplication({
      dataDir: () => getDataDir(),
      directory: createAgentDirectoryPort(),
      workspaces: createJean2AgentWorkspacePort(),
      preconfigs: createJean2AgentPreconfigPort(),
    });

    const agent = await application.promotePreconfig('coder');
    expect(agent.id).toBe('coder');
    expect(agent.hasHome).toBe(true);
    expect(agent.systemPrompt).toBe('Be concise.');

    const workspace = getWorkspace('coder-home');
    expect(workspace).not.toBeNull();
    expect(workspace!.path).toBe(join(getDataDir(), 'agents', 'coder', 'home'));
    expect(workspace!.isVirtual).toBe(true);
    expect(workspace!.settings).toEqual({ ...agentHomeWorkspaceSettings('coder'), autoApproveSeverity: 'low' });

    await application.demoteAgent('coder');
    expect(getWorkspace('coder-home')).toBeNull();
    expect(await application.getAgentDirectory('coder')).toBeNull();
  });

  test('promote uses the exact preconfig lookup and throws for unknown preconfigs', async () => {
    const application = createAgentsApplication({
      dataDir: () => getDataDir(),
      directory: createAgentDirectoryPort(),
      workspaces: createJean2AgentWorkspacePort(),
      preconfigs: createJean2AgentPreconfigPort(),
    });

    await expect(application.promotePreconfig('missing')).rejects.toThrow('Preconfig not found');
  });
});
