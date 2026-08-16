import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import {
  configureStorage,
  createInMemoryStorageBundle,
  getStorage,
} from '@capekai/core/storage';
import {
  configureJean2Storage,
  jean2StorageBundle,
} from '@/adapters/capek/storage';
import {
  addMessageToQueue,
  buildEffectiveContextHistory,
  createMessage,
  createPart,
  createSession,
  deleteMessage,
  deleteQueuedMessage,
  getAttachment,
  getChildSessions,
  getMessage,
  getMessageWithParts,
  getNextQueuedMessage,
  getPart,
  getPartsByMessage,
  getPartsBySession,
  getResponseFormat,
  getSession,
  getWorkspace,
  jean2ToolOutputArtifactStore,
  listLatestMessagesWithPartsPage,
  listMessagesWithParts,
  persistStreamingPartSnapshots,
  syncMessageFts,
  transitionToolToInterrupted,
  transitionToolToRunningByCallId,
  updateMessage,
  updateSession,
} from '@/store';
import { getWorkspaceAutoApproveSeverity } from '@/store/workspaces';
import { searchMessages } from '@/session-search/fts';
import { resetTestDatabase, setupTestDatabase } from '#tests/db';
import { createTestAssistantMessage, createTestTextPart, createTestUserMessage } from '#tests/factories';
import { seedSession, seedWorkspace } from '#tests/seed';

// File-scoped module mock: indexMessage records calls and delegates to the
// real implementation. Every other fts export stays real, so schema setup and
// search behavior are unchanged. This makes the store's internal
// syncMessageToFts path observable for the updateMessage wrapper.
const realFts = await import('@/session-search/fts');
const realIndexMessage = realFts.indexMessage;
const indexCalls: string[] = [];

mock.module('@/session-search/fts', () => ({
  ...realFts,
  indexMessage: (...args: unknown[]): void => {
    indexCalls.push(String(args[0]));
    realIndexMessage(...(args as Parameters<typeof realIndexMessage>));
  },
}));

describe('Čapek storage adapter', () => {
  beforeEach(() => {
    indexCalls.length = 0;
    setupTestDatabase();
  });

  afterEach(() => {
    configureStorage(createInMemoryStorageBundle());
    resetTestDatabase();
  });

  test('exposes the exact store mapping with no shadowed extras', () => {
    expect(Object.keys(jean2StorageBundle.conversation).sort()).toEqual([
      'buildEffectiveContextHistory', 'createMessage', 'createPart', 'createSession',
      'deleteMessage', 'getChildSessions', 'getMessage', 'getMessageWithParts',
      'getPart', 'getPartsByMessage', 'getPartsBySession', 'getSession',
      'listLatestMessagesWithPartsPage', 'listMessagesWithParts',
      'persistStreamingPartSnapshots', 'transitionToolToInterrupted',
      'transitionToolToRunningByCallId', 'updateMessage', 'updatePart', 'updateSession',
    ].sort());

    const conversation = jean2StorageBundle.conversation;
    expect(conversation.createSession).toBe(createSession);
    expect(conversation.createMessage).toBe(createMessage);
    expect(conversation.getMessage).toBe(getMessage);
    expect(conversation.getMessageWithParts).toBe(getMessageWithParts);
    expect(conversation.deleteMessage).toBe(deleteMessage);
    expect(conversation.getSession).toBe(getSession);
    expect(conversation.updateSession).toBe(updateSession);
    expect(conversation.transitionToolToInterrupted).toBe(transitionToolToInterrupted);
    expect(conversation.getPartsByMessage).toBe(getPartsByMessage);
    expect(conversation.getPart).toBe(getPart);
    expect(conversation.persistStreamingPartSnapshots).toBe(persistStreamingPartSnapshots);
    expect(conversation.transitionToolToRunningByCallId).toBe(transitionToolToRunningByCallId);
    expect(conversation.getChildSessions).toBe(getChildSessions);
    expect(conversation.listMessagesWithParts).toBe(listMessagesWithParts);
    expect(conversation.listLatestMessagesWithPartsPage).toBe(listLatestMessagesWithPartsPage);
    expect(conversation.getPartsBySession).toBe(getPartsBySession);
    expect(conversation.buildEffectiveContextHistory).toBe(buildEffectiveContextHistory);

    expect(jean2StorageBundle.toolOutputArtifacts).toBe(jean2ToolOutputArtifactStore);
    expect(jean2StorageBundle.queue.addMessage).toBe(addMessageToQueue);
    expect(jean2StorageBundle.queue.delete).toBe(deleteQueuedMessage);
    expect(jean2StorageBundle.queue.peek).toBe(getNextQueuedMessage);
    expect(jean2StorageBundle.attachments.get).toBe(getAttachment);
    expect(jean2StorageBundle.workspaces.get).toBe(getWorkspace);
    expect(jean2StorageBundle.workspaces.getAutoApproveSeverity).toBe(getWorkspaceAutoApproveSeverity);
    expect(jean2StorageBundle.responseFormats.get).toBe(getResponseFormat);
    expect(jean2StorageBundle.index.syncMessage).toBe(syncMessageFts);
  });

  test('wraps part mutations with syncFts:false while rows still change', () => {
    seedWorkspace({ id: 'ws1' });
    const session = seedSession('ws1');
    createMessage(createTestUserMessage(session.id, { id: 'message-1' }));

    const indexed = createTestTextPart('message-1', 'original text');
    createPart(indexed, session.id);
    expect(searchMessages({
      query: 'original',
      sessionId: session.id,
      roleFilter: ['user', 'assistant'],
      limit: 10,
      sort: 'newest',
    })).toHaveLength(1);

    const updated = jean2StorageBundle.conversation.updatePart(indexed.id, { text: 'changed text' });
    expect((updated as { text?: string })?.text).toBe('changed text');
    expect((getPart(indexed.id) as { text?: string })?.text).toBe('changed text');
    expect(searchMessages({
      query: 'changed',
      sessionId: session.id,
      roleFilter: ['user', 'assistant'],
      limit: 10,
      sort: 'newest',
    })).toHaveLength(0);

    const fresh = createTestTextPart('message-1', 'fresh text');
    jean2StorageBundle.conversation.createPart(fresh, session.id);
    expect(getPartsByMessage('message-1')).toHaveLength(2);
    expect(searchMessages({
      query: 'fresh',
      sessionId: session.id,
      roleFilter: ['user', 'assistant'],
      limit: 10,
      sort: 'newest',
    })).toHaveLength(0);
  });

  test('wraps message updates with syncFts:false while rows still change', () => {
    seedWorkspace({ id: 'ws1' });
    const session = seedSession('ws1');
    createMessage(createTestAssistantMessage(session.id, { id: 'message-update' }));
    createPart(createTestTextPart('message-update', 'indexed content'), session.id);
    expect(indexCalls).toEqual(['message-update']);

    indexCalls.length = 0;
    const updated = jean2StorageBundle.conversation.updateMessage('message-update', { summary: true });
    expect((updated as { summary?: boolean } | null)?.summary).toBe(true);
    expect((getMessage('message-update') as { summary?: boolean } | null)?.summary).toBe(true);
    expect(indexCalls).toEqual([]);

    updateMessage('message-update', { summary: false });
    expect((getMessage('message-update') as { summary?: boolean } | null)?.summary).toBeUndefined();
    expect(indexCalls).toEqual(['message-update']);
  });

  test('installs the module-level storage bundle by identity', () => {
    configureJean2Storage();
    expect(getStorage()).toBe(jean2StorageBundle);
  });
});
