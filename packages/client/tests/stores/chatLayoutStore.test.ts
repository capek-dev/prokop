import { describe, test, expect, beforeEach } from 'vitest';
import { useChatLayoutStore } from '@/stores/chatLayoutStore';

describe('chatLayoutStore', () => {
  beforeEach(() => {
    useChatLayoutStore.setState({ mobileSurface: 'chat' });
  });

  describe('mobileSurface', () => {
    test('moves between one primary phone surface at a time', () => {
      expect(useChatLayoutStore.getState().mobileSurface).toBe('chat');

      useChatLayoutStore.getState().setMobileSurface('sessions');
      expect(useChatLayoutStore.getState().mobileSurface).toBe('sessions');

      useChatLayoutStore.getState().setMobileSurface('files');
      expect(useChatLayoutStore.getState().mobileSurface).toBe('files');

      useChatLayoutStore.getState().setMobileSurface('editor');
      expect(useChatLayoutStore.getState().mobileSurface).toBe('editor');

      useChatLayoutStore.getState().setMobileSurface('chat');
      expect(useChatLayoutStore.getState().mobileSurface).toBe('chat');
    });
  });

});
