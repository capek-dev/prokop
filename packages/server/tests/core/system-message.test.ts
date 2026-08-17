import { beforeEach, describe, expect, test } from 'bun:test';
import type { Preconfig } from '@jean2/sdk';
import { createRuntime } from '@/bootstrap/create-runtime';
import { buildSystemMessage } from '@capekai/core/internal/execution';

const preconfig: Preconfig = {
  id: 'self-delegating-agent-test',
  name: 'Self-delegating agent test',
  description: 'Test preconfig',
  systemPrompt: 'Base system prompt',
  tools: null,
  model: null,
  provider: null,
  settings: null,
  isDefault: false,
};

describe('buildSystemMessage self-delegation guidance', () => {
  beforeEach(() => createRuntime());
  test('announces self-delegation when it is available', async () => {
    const message = await buildSystemMessage({
      preconfig,
      selfDelegationAvailable: true,
    });

    expect(message).toContain('SELF-DELEGATION:');
    expect(message).toContain('subagent_type "self-delegating-agent-test"');
    expect(message).toContain('only to the immediate child');
  });

  test('omits self-delegation guidance when it is unavailable', async () => {
    const message = await buildSystemMessage({ preconfig });

    expect(message).not.toContain('SELF-DELEGATION:');
  });
});
