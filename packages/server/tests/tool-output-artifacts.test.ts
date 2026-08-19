import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createApp } from '@/transport/http/app';
import { jean2StorageBundle } from '@/adapters/capek';
import {
  createToolOutputArtifact,
  getToolOutputArtifactPage,
} from '@/infrastructure/sqlite/tool-output-artifacts';
import { deleteSession } from '@/infrastructure/sqlite/session-store';
import { deleteWorkspace } from '@/infrastructure/sqlite/workspaces';
import { getDatabase } from '@/infrastructure/sqlite/database';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedSession, seedWorkspace } from '#tests/seed';
import { setupTestDataDir, resetTestDataDir } from '#tests/test-dir';

function countArtifacts(): number {
  return (getDatabase().query('SELECT COUNT(*) AS count FROM tool_output_artifacts').get() as { count: number }).count;
}

describe('Jean2 tool output artifacts', () => {
  beforeEach(() => {
    delete process.env.JEAN2_AUTH_TOKEN;
    setupTestDataDir();
    setupTestDatabase();
    seedWorkspace({ id: 'workspace-1' });
    seedSession('workspace-1', { id: 'session-1' });
    seedSession('workspace-1', { id: 'session-2' });
  });

  afterEach(() => {
    delete process.env.JEAN2_AUTH_TOKEN;
    resetTestDatabase();
    resetTestDataDir();
  });

  test('adapts scoped storage with malformed and cross-session denial', () => {
    expect(jean2StorageBundle.toolOutputArtifacts.create).toBe(createToolOutputArtifact);
    const artifact = jean2StorageBundle.toolOutputArtifacts.create({
      sessionId: 'session-1',
      workspaceId: 'workspace-1',
      toolCallId: 'call-1',
      toolName: 'synthetic',
      content: 'x'.repeat(30_000),
      format: 'text',
    });

    expect(getToolOutputArtifactPage('session-1', 'malformed')).toBeNull();
    expect(getToolOutputArtifactPage('session-2', artifact.id)).toBeNull();
    expect(getToolOutputArtifactPage('session-1', artifact.id, 5, 30_000)).toMatchObject({
      offset: 5,
      limit: 20_000,
      totalChars: 30_000,
      nextOffset: 20_005,
      complete: false,
    });
  });

  test('serves protected bounded pages and returns not found across scopes', async () => {
    const artifact = createToolOutputArtifact({
      sessionId: 'session-1',
      workspaceId: 'workspace-1',
      toolCallId: 'call-1',
      toolName: 'synthetic',
      content: '0123456789'.repeat(3_000),
      format: 'text',
    });
    process.env.JEAN2_AUTH_TOKEN = 'secret';
    const app = createApp();
    const path = `/api/sessions/session-1/tool-output-artifacts/${artifact.id}`;

    expect((await app.request(path)).status).toBe(401);
    const response = await app.request(`${path}?offset=7&limit=11`, {
      headers: { Authorization: 'Bearer secret' },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      artifactId: artifact.id,
      content: '78901234567',
      offset: 7,
      limit: 11,
      totalChars: 30_000,
      nextOffset: 18,
      complete: false,
    });

    const cross = await app.request(`/api/sessions/session-2/tool-output-artifacts/${artifact.id}`, {
      headers: { Authorization: 'Bearer secret' },
    });
    expect(cross.status).toBe(404);
    const malformed = await app.request('/api/sessions/session-1/tool-output-artifacts/not-a-uuid', {
      headers: { Authorization: 'Bearer secret' },
    });
    expect(malformed.status).toBe(400);
    const invalidLimit = await app.request(`${path}?limit=20001`, {
      headers: { Authorization: 'Bearer secret' },
    });
    expect(invalidLimit.status).toBe(400);
    const invalidOffset = await app.request(`${path}?offset=-1`, {
      headers: { Authorization: 'Bearer secret' },
    });
    expect(invalidOffset.status).toBe(400);
  });

  test('cascades artifacts on session and workspace deletion', () => {
    createToolOutputArtifact({
      sessionId: 'session-1',
      workspaceId: 'workspace-1',
      toolCallId: 'call-1',
      toolName: 'synthetic',
      content: 'first',
      format: 'text',
    });
    createToolOutputArtifact({
      sessionId: 'session-2',
      workspaceId: 'workspace-1',
      toolCallId: 'call-2',
      toolName: 'synthetic',
      content: 'second',
      format: 'text',
    });
    expect(countArtifacts()).toBe(2);

    deleteSession('session-1');
    expect(countArtifacts()).toBe(1);
    deleteWorkspace('workspace-1');
    expect(countArtifacts()).toBe(0);
  });
});
