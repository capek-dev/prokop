import { describe, expect, test } from 'vitest';
import {
  bindingFromRecordedKeys,
  findKeybindingConflict,
  formatKeybinding,
  isReservedBrowserBinding,
  normalizeKeybinding,
  parseStoredKeybindingSettings,
  resolveKeybinding,
  resolvePlatformBinding,
} from '@/lib/keybindings';

describe('keybindings', () => {
  test('normalizes chords and unmodified sequences', () => {
    expect(normalizeKeybinding('Shift+MOD+KeyF')).toBe('mod+shift+f');
    expect(normalizeKeybinding('Esc > Escape')).toBe('escape>escape');
    expect(normalizeKeybinding('mod++n')).toBeNull();
    expect(normalizeKeybinding('mod+n>escape')).toBeNull();
  });

  test('resolves and formats the portable mod key', () => {
    expect(resolvePlatformBinding('mod+shift+f', true)).toBe('meta+shift+f');
    expect(resolvePlatformBinding('mod+shift+f', false)).toBe('ctrl+shift+f');
    expect(formatKeybinding('mod+shift+f', true)).toBe('⌘ + Shift + F');
  });

  test('turns recorded platform modifiers into portable bindings', () => {
    expect(bindingFromRecordedKeys(new Set(['meta', 'KeyS']), true)).toBe('mod+s');
    expect(bindingFromRecordedKeys(new Set(['ControlLeft', 'Digit2']), false)).toBe('mod+2');
  });

  test('distinguishes inherited, custom, and explicitly unset bindings', () => {
    expect(resolveKeybinding('session.create', {})).toBe('mod+n');
    expect(resolveKeybinding('session.create', { 'session.create': 'alt+n' })).toBe('alt+n');
    expect(resolveKeybinding('session.create', { 'session.create': null })).toBeNull();
  });

  test('finds platform-equivalent conflicts', () => {
    expect(findKeybindingConflict('navigation.files', 'meta+1', {}, true)?.id)
      .toBe('navigation.sessions');
  });

  test('parses persisted settings fail-closed', () => {
    expect(parseStoredKeybindingSettings({
      version: 1,
      overrides: {
        'session.create': 'ALT+KeyN',
        'navigation.files': null,
        unknown: 'mod+x',
        'navigation.terminal': 42,
      },
    })).toEqual({
      version: 1,
      overrides: {
        'session.create': 'alt+n',
        'navigation.files': null,
      },
    });
    expect(parseStoredKeybindingSettings({ version: 2, overrides: {} }))
      .toEqual({ version: 1, overrides: {} });
  });

  test('warns for known browser-reserved bindings', () => {
    expect(isReservedBrowserBinding('mod+w', true)).toBe(true);
    expect(isReservedBrowserBinding('mod+s', true)).toBe(false);
  });
});
