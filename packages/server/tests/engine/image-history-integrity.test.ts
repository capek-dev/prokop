import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MessageWithParts } from '@prokopai/sdk/types';
import { convertToAiSdkMessages } from '@/harnesses/prokop/execution/message-utils';
import { createInMemoryStorageBundle } from '@/infrastructure/storage/memory';
import { withStorage } from '@/infrastructure/storage/runtime';

const image: MessageWithParts = {
  message: { id: 'user', sessionId: 'session', role: 'user', createdAt: 1 },
  parts: [
    { id: 'text', messageId: 'user', type: 'text', text: 'What is shown?', createdAt: 1 },
    { id: 'image', messageId: 'user', type: 'image', mimeType: 'image/png',
      url: '/api/sessions/session/attachments/screenshot/content', createdAt: 2 },
  ],
};

const capabilities = { input: { image: true } };

test('image history includes readable attachment bytes and never falls back to text alone', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'capek-image-history-'));
  const file = join(dir, 'image.png');
  const storage = createInMemoryStorageBundle();
  try {
    writeFileSync(file, Buffer.from([1, 2, 3]));
    storage.attachments.get = async () => ({ id: 'screenshot', sessionId: 'session', workspaceId: dir,
      kind: 'image', filename: 'image.png', mimeType: 'image/png', sizeBytes: 3,
      absolutePath: file, createdAt: new Date().toISOString(), accessKey: 'key' });
    const history = await withStorage(storage, () => convertToAiSdkMessages([image], capabilities));
    expect(history).toMatchObject([{ role: 'user', content: [
      { type: 'text', text: 'What is shown?' },
      { type: 'image', image: new Uint8Array([1, 2, 3]), mimeType: 'image/png' },
    ] }]);
    rmSync(file);
    await expect(withStorage(storage, () => convertToAiSdkMessages([image], capabilities)))
      .rejects.toThrow('Image attachment could not be read: image');
    storage.attachments.get = async () => null;
    await expect(withStorage(storage, () => convertToAiSdkMessages([image], capabilities)))
      .rejects.toThrow('Image attachment is unavailable: image');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
