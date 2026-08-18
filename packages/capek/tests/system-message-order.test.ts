import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import type { Preconfig } from '@capekai/types';
import {
  configureAgentSource,
  configureInstructionSource,
  configurePreconfigSource,
} from '../src/context/sources';
import { buildSystemMessage } from '../src/plugins/legacy-system-message';
import { configureStorage, createInMemoryStorageBundle } from '../src/storage';

const preconfig = {
  id: 'agent',
  name: 'Agent',
  systemPrompt: 'PRECONFIG',
} as Preconfig;
const workspacePath = join(process.cwd(), '.tmp-capek-system-message');

afterEach(async () => {
  configureAgentSource();
  configureInstructionSource();
  configurePreconfigSource();
  await rm(workspacePath, { recursive: true, force: true });
});

describe('ordered system context', () => {
  test('preserves section order and workspace-setting omission', async () => {
    configureStorage(createInMemoryStorageBundle({
      workspaces: [{
        id: 'workspace',
        name: 'Workspace',
        path: '/workspace',
        isVirtual: false,
        additionalPaths: [],
        settings: {
          autoApproveSeverity: 'low',
          memory: { enabled: true, permissionRisk: 'low' },
          skills: { managementEnabled: true, permissionRisk: 'low' },
          sessionSearch: { enabled: true, permissionRisk: 'low', includeToolResults: false },
        },
        createdAt: '',
        updatedAt: '',
      }],
    }));
    configureAgentSource({
      getDirectory: async () => '/agents/agent',
      readMemoryFile: async (_id, file) => file === 'USER.md' ? 'AGENT_USER' : 'AGENT_MEMORY',
    });
    await mkdir(join(workspacePath, '.capek'), { recursive: true });
    await writeFile(join(workspacePath, '.capek', 'MEMORY.md'), '- WORKSPACE_MEMORY');

    const message = await buildSystemMessage({
      preconfig,
      workspacePath,
      workspaceId: 'workspace',
      selfDelegationAvailable: true,
    });
    const sections = [
      'AGENT_MEMORY',
      'AGENT_USER',
      'PRECONFIG',
      'MEMORY:',
      'SELF-DELEGATION:',
      '<workspace>',
      'WORKSPACE_MEMORY',
      'You can persist durable workspace knowledge',
      'You can create and update workspace skills',
      'You can use session_search to recall prior conversation details',
    ];
    for (let index = 1; index < sections.length; index += 1) {
      const previousIndex = message.indexOf(sections[index - 1]);
      const currentIndex = message.indexOf(sections[index]);
      expect(previousIndex).toBeGreaterThanOrEqual(0);
      expect(currentIndex).toBeGreaterThan(previousIndex);
    }

    const omitted = await buildSystemMessage({ preconfig });
    expect(omitted).not.toContain('WORKSPACE_MEMORY');
    expect(omitted).not.toContain('SELF-DELEGATION:');
  });
});
