import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { PermissionAsk } from '@jean2/sdk';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspaceWithSession } from '#tests/seed';
import { executeSchedulerTool } from '@capekai/core/hosts';

describe('scheduler ask gating', () => {
  let workspaceId: string;
  let sessionId: string;

  beforeEach(() => {
    setupTestDatabase();
    const seeded = seedWorkspaceWithSession();
    workspaceId = seeded.workspaceId;
    sessionId = seeded.sessionId;
  });

  afterEach(() => {
    resetTestDatabase();
  });

  test('does not ask for read-only list', async () => {
    let asked = false;
    const result = await executeSchedulerTool(
      { action: 'list' },
      workspaceId,
      sessionId,
      'high',
      async () => {
        asked = true;
        return false;
      },
    );

    expect(asked).toBe(false);
    expect(result.success).toBe(true);
  });

  test('does not ask when permission risk is none', async () => {
    let asked = false;
    await executeSchedulerTool(
      { action: 'list' },
      workspaceId,
      sessionId,
      'none',
      async () => {
        asked = true;
        return false;
      },
    );
    expect(asked).toBe(false);
  });

  test('asks for mutating actions and stops on denial', async () => {
    let received: PermissionAsk | null = null;
    const result = await executeSchedulerTool(
      { action: 'remove', jobId: 'job-1' },
      workspaceId,
      sessionId,
      'medium',
      async (ask) => {
        received = ask;
        return false;
      },
    );

    expect(received).toMatchObject({
      type: 'permission',
      resource: 'scheduler',
      action: 'delete',
      risk: 'medium',
    });
    expect(result).toEqual({
      success: false,
      action: 'remove',
      title: 'Permission denied',
      error: 'USER_REJECTION',
    });
  });
});
