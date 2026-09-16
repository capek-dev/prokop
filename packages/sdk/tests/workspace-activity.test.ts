import { expect, mock, test } from 'bun:test';
import { TypedEventEmitter } from '../src/emitter';
import { routeServerMessage, type SdkEventMap } from '../src/types/server-messages';

test('workspace activity routes timestamps and deletion resets', () => {
  const emitter = new TypedEventEmitter<SdkEventMap>();
  const handler = mock(() => {});
  emitter.on('workspace.conversation_activity', handler);
  routeServerMessage(emitter, { type: 'workspace.conversation_activity', workspaceId: 'ws', lastConversationAt: 123 });
  expect(handler).toHaveBeenLastCalledWith('ws', 123);
  routeServerMessage(emitter, { type: 'workspace.conversation_activity', workspaceId: 'ws', lastConversationAt: null });
  expect(handler).toHaveBeenLastCalledWith('ws', null);
});
