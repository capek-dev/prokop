import { describe, test, expect } from 'bun:test';
import { MessageType } from '../src/messages';

describe('messages', () => {
  test('all message types are defined', () => {
    expect(MessageType.Init).toBe('prokopai:init');
    expect(MessageType.ThemeChanged).toBe('prokopai:themeChanged');
    expect(MessageType.WorkspaceChanged).toBe('prokopai:workspaceChanged');
    expect(MessageType.Ready).toBe('prokopai:ready');
    expect(MessageType.OpenFile).toBe('prokopai:openFile');
    expect(MessageType.ToggleTerminal).toBe('prokopai:toggleTerminal');
    expect(MessageType.ToggleExplorer).toBe('prokopai:toggleExplorer');
    expect(MessageType.Connected).toBe('prokopai:connected');
    expect(MessageType.Disconnected).toBe('prokopai:disconnected');
  });

  test('no duplicate values', () => {
    const values = Object.values(MessageType);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });

  test('every message type has a prokopai: prefix', () => {
    for (const value of Object.values(MessageType)) {
      expect(value.startsWith('prokopai:')).toBe(true);
    }
  });
});
