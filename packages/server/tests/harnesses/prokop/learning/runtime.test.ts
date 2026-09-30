import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import type { Workspace } from '@prokopai/sdk';
import { createProkopLearningRuntime } from '@/harnesses/prokop/learning';

const agents = { getAgentDirectory: async () => null };

function workspace(path: string): Workspace {
  return { id: 'ws', path, settings: {} } as unknown as Workspace;
}

describe('prokop learning runtime port implementation', () => {
  test('declares the prokop harness identity and resolves workspace destinations', async () => {
    const runtime = createProkopLearningRuntime({ agents });
    expect(runtime.harness).toBe('prokop');

    const directories = await runtime.directories(workspace('/tmp/project'));
    expect(directories.skillsDirectory).toBe(resolve('/tmp/project/.agents/skills'));
    expect(directories.memoryDirectory).toContain('.prokopai');
  });

  test('assembles history and execution from caller-owned persistence', () => {
    const runtime = createProkopLearningRuntime({ agents });

    const history = runtime.createHistory({
      repository: {} as never,
      workspace: () => null,
      directories: runtime.directories,
      now: () => 0,
    });
    expect(typeof history.undo).toBe('function');
    expect(typeof history.reconcile).toBe('function');

    const execute = runtime.createExecution({
      database: {} as never,
      repository: {} as never,
      workspace: () => null,
      directories: runtime.directories,
      createSession: () => 'review-session',
    });
    expect(typeof execute).toBe('function');
  });
});
