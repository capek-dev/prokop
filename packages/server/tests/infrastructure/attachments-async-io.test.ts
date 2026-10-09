import { afterEach, beforeEach, expect, test } from 'bun:test';
import { existsSync, rmSync } from 'node:fs';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspaceWithSession } from '#tests/seed';
import { resetTestDataDir, setupTestDataDir } from '#tests/test-dir';
import { createProkopSessionRepository } from '@/adapters/prokop/session-repository';
import { createAttachment, deleteAttachmentsForSession, getAttachmentsForSession } from '@/infrastructure/sqlite/attachments';
import { getAttachmentDir } from '@/infrastructure/runtime/paths';

let ids: { workspaceId: string; sessionId: string };

beforeEach(() => {
  setupTestDataDir();
  setupTestDatabase();
  ids = seedWorkspaceWithSession();
});

afterEach(() => {
  resetTestDatabase();
  resetTestDataDir();
});

async function waitUntilGone(path: string): Promise<boolean> {
  for (let attempt = 0; attempt < 100 && existsSync(path); attempt++) await Bun.sleep(10);
  return !existsSync(path);
}

const upload = (filename = 'photo.png') => createAttachment({
  ...ids, filename, mimeType: 'image/png', sizeBytes: 4, data: new Uint8Array([137, 80, 78, 71]).buffer,
});

test('upload writes the file asynchronously and records it', async () => {
  const attachment = await upload();
  expect(await Bun.file(attachment.absolutePath).bytes()).toEqual(new Uint8Array([137, 80, 78, 71]));
  expect(getAttachmentsForSession(ids.sessionId).map((row) => row.id)).toEqual([attachment.id]);
});

test('openFile returns a lazily read Blob, or null once the file is gone', async () => {
  const attachments = createProkopSessionRepository({ getPreconfigOrAgent: () => null, isAgentSync: () => false } as never).attachments;
  const record = await attachments.create({ ...ids, filename: 'photo.png', mimeType: 'image/png', sizeBytes: 4,
    data: new Uint8Array([137, 80, 78, 71]).buffer });

  const blob = await attachments.openFile(record);
  expect(blob?.size).toBe(4);
  expect(new Uint8Array(await blob!.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]));

  rmSync(record.absolutePath);
  expect(await attachments.openFile(record)).toBeNull();
});

test('session delete removes rows at once and files in the background', async () => {
  const first = await upload('a.png');
  const second = await upload('b.png');

  deleteAttachmentsForSession(ids.sessionId);

  expect(getAttachmentsForSession(ids.sessionId)).toEqual([]);
  expect(await waitUntilGone(first.absolutePath)).toBe(true);
  expect(await waitUntilGone(second.absolutePath)).toBe(true);
  expect(await waitUntilGone(getAttachmentDir(ids.workspaceId, ids.sessionId))).toBe(true);
});
