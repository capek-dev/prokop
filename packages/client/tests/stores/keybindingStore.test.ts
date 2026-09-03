import { beforeEach, describe, expect, test } from 'vitest';
import { STORAGE_KEYS } from '@/lib/storage';
import { useKeybindingStore } from '@/stores/keybindingStore';

describe('keybindingStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useKeybindingStore.setState({ overrides: {} });
  });

  test('persists custom and explicitly unset bindings', () => {
    useKeybindingStore.getState().setBinding('session.create', 'Alt+KeyN');
    useKeybindingStore.getState().unsetBinding('navigation.files');

    expect(useKeybindingStore.getState().overrides).toEqual({
      'session.create': 'alt+n',
      'navigation.files': null,
    });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.KEYBINDINGS) ?? 'null')).toEqual({
      version: 1,
      overrides: {
        'session.create': 'alt+n',
        'navigation.files': null,
      },
    });
  });

  test('resets one binding or all bindings', () => {
    useKeybindingStore.setState({
      overrides: { 'session.create': 'alt+n', 'navigation.files': null },
    });

    useKeybindingStore.getState().resetBinding('session.create');
    expect(useKeybindingStore.getState().overrides).toEqual({ 'navigation.files': null });

    useKeybindingStore.getState().resetAllBindings();
    expect(useKeybindingStore.getState().overrides).toEqual({});
  });

  test('ignores malformed assignments', () => {
    useKeybindingStore.getState().setBinding('session.create', 'mod++n');
    expect(useKeybindingStore.getState().overrides).toEqual({});
  });
});
