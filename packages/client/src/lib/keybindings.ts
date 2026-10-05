export type KeybindingCommandId =
  | 'dock.focusLeft'
  | 'dock.focusRight'
  | 'dock.focusBottom'
  | 'navigation.overview'
  | 'session.create'
  | 'dock.closeFocused'
  | 'chat.focusInput'
  | 'chat.stopStreaming'
  | 'chat.toggleAutoFollow'
  | 'tab.focus.1'
  | 'tab.focus.2'
  | 'tab.focus.3'
  | 'tab.focus.4'
  | 'tab.focus.5'
  | 'tab.focus.6'
  | 'tab.focus.7'
  | 'tab.focus.8'
  | 'tab.focus.9'
  | 'tab.focusPrevious'
  | 'tab.focusNext'
  | 'editor.save'
  | 'editor.close';

export type KeybindingContext = 'global' | 'chat' | 'editor';

export interface KeybindingCommand {
  id: KeybindingCommandId;
  label: string;
  category: 'Navigation' | 'Chat' | 'Tabs' | 'Editor';
  defaultBinding: string;
  context: KeybindingContext;
  allowInInputs?: boolean;
}

export type KeybindingOverrides = Partial<Record<KeybindingCommandId, string | null>>;

export interface StoredKeybindingSettings {
  version: 1;
  overrides: KeybindingOverrides;
}

export const KEYBINDING_COMMANDS = [
  { id: 'dock.focusLeft', label: 'Focus left dock', category: 'Navigation', defaultBinding: 'mod+1', context: 'global', allowInInputs: true },
  { id: 'dock.focusRight', label: 'Focus right dock', category: 'Navigation', defaultBinding: 'mod+2', context: 'global', allowInInputs: true },
  { id: 'dock.focusBottom', label: 'Focus bottom dock', category: 'Navigation', defaultBinding: 'mod+t', context: 'global', allowInInputs: true },
  { id: 'navigation.overview', label: 'Toggle overview mode', category: 'Navigation', defaultBinding: 'mod+o', context: 'global', allowInInputs: true },
  { id: 'session.create', label: 'New session', category: 'Navigation', defaultBinding: 'mod+n', context: 'global', allowInInputs: true },
  { id: 'dock.closeFocused', label: 'Close focused dock', category: 'Navigation', defaultBinding: 'shift+escape', context: 'global', allowInInputs: true },
  { id: 'chat.focusInput', label: 'Focus chat input', category: 'Chat', defaultBinding: 'escape', context: 'global', allowInInputs: true },
  { id: 'chat.stopStreaming', label: 'Stop streaming', category: 'Chat', defaultBinding: 'escape>escape', context: 'chat', allowInInputs: true },
  { id: 'chat.toggleAutoFollow', label: 'Toggle follow/free mode', category: 'Chat', defaultBinding: 'mod+shift+f', context: 'global', allowInInputs: true },
  { id: 'tab.focus.1', label: 'Focus tab 1', category: 'Tabs', defaultBinding: 'alt+1', context: 'global', allowInInputs: true },
  { id: 'tab.focus.2', label: 'Focus tab 2', category: 'Tabs', defaultBinding: 'alt+2', context: 'global', allowInInputs: true },
  { id: 'tab.focus.3', label: 'Focus tab 3', category: 'Tabs', defaultBinding: 'alt+3', context: 'global', allowInInputs: true },
  { id: 'tab.focus.4', label: 'Focus tab 4', category: 'Tabs', defaultBinding: 'alt+4', context: 'global', allowInInputs: true },
  { id: 'tab.focus.5', label: 'Focus tab 5', category: 'Tabs', defaultBinding: 'alt+5', context: 'global', allowInInputs: true },
  { id: 'tab.focus.6', label: 'Focus tab 6', category: 'Tabs', defaultBinding: 'alt+6', context: 'global', allowInInputs: true },
  { id: 'tab.focus.7', label: 'Focus tab 7', category: 'Tabs', defaultBinding: 'alt+7', context: 'global', allowInInputs: true },
  { id: 'tab.focus.8', label: 'Focus tab 8', category: 'Tabs', defaultBinding: 'alt+8', context: 'global', allowInInputs: true },
  { id: 'tab.focus.9', label: 'Focus tab 9', category: 'Tabs', defaultBinding: 'alt+9', context: 'global', allowInInputs: true },
  { id: 'tab.focusPrevious', label: 'Focus previous tab', category: 'Tabs', defaultBinding: 'alt+shift+left', context: 'global', allowInInputs: true },
  { id: 'tab.focusNext', label: 'Focus next tab', category: 'Tabs', defaultBinding: 'alt+shift+right', context: 'global', allowInInputs: true },
  { id: 'editor.save', label: 'Save active file', category: 'Editor', defaultBinding: 'mod+s', context: 'editor', allowInInputs: true },
  { id: 'editor.close', label: 'Close active file', category: 'Editor', defaultBinding: 'mod+w', context: 'editor', allowInInputs: true },
] as const satisfies readonly KeybindingCommand[];

const COMMAND_IDS = new Set<KeybindingCommandId>(KEYBINDING_COMMANDS.map((command) => command.id));
const MODIFIER_ORDER = ['mod', 'meta', 'ctrl', 'alt', 'shift'] as const;
const MODIFIERS = new Set<string>([...MODIFIER_ORDER, 'control']);
const KEY_ALIASES: Record<string, string> = {
  altleft: 'alt',
  altright: 'alt',
  arrowdown: 'down',
  arrowleft: 'left',
  arrowright: 'right',
  arrowup: 'up',
  control: 'ctrl',
  controlleft: 'ctrl',
  controlright: 'ctrl',
  esc: 'escape',
  metaleft: 'meta',
  metaright: 'meta',
  return: 'enter',
  shiftleft: 'shift',
  shiftright: 'shift',
};

export function isKeybindingCommandId(value: string): value is KeybindingCommandId {
  return COMMAND_IDS.has(value as KeybindingCommandId);
}

export function getKeybindingCommand(id: KeybindingCommandId): KeybindingCommand {
  const command = KEYBINDING_COMMANDS.find((candidate) => candidate.id === id);
  if (!command) throw new Error(`Unknown keybinding command: ${id}`);
  return command;
}

function normalizeKeyToken(token: string): string {
  const normalized = token.trim().toLowerCase().replace(/^(key|digit|numpad)/, '');
  return KEY_ALIASES[normalized] ?? normalized;
}

function normalizeChord(chord: string): string | null {
  const rawTokens = chord.split('+');
  if (rawTokens.some((token) => token.trim() === '')) return null;

  const tokens = rawTokens.map(normalizeKeyToken);
  const modifiers = new Set(tokens.filter((token) => MODIFIERS.has(token)).map((token) => KEY_ALIASES[token] ?? token));
  const keys = tokens.filter((token) => !MODIFIERS.has(token));
  if (keys.length !== 1 || !/^[a-z0-9`.-]+$/.test(keys[0])) return null;
  if (modifiers.size + keys.length !== tokens.length) return null;

  return [
    ...MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)),
    keys[0],
  ].join('+');
}

export function normalizeKeybinding(binding: string): string | null {
  const sequence = binding.split('>');
  if (sequence.some((part) => part.trim() === '')) return null;
  if (sequence.length > 1) {
    const normalized = sequence.map(normalizeChord);
    if (normalized.some((part) => part === null || part.includes('+'))) return null;
    return normalized.join('>');
  }
  return normalizeChord(binding);
}

export function isApplePlatform(platform?: string): boolean {
  if (platform !== undefined) return /mac|iphone|ipad|ipod/i.test(platform);
  if (typeof navigator === 'undefined') return false;
  const userAgentDataPlatform = (navigator as Navigator & {
    userAgentData?: { platform?: string };
  }).userAgentData?.platform;
  return /mac|iphone|ipad|ipod/i.test(userAgentDataPlatform ?? navigator.userAgent);
}

export function resolvePlatformBinding(binding: string, apple = isApplePlatform()): string {
  return binding
    .split('>')
    .map((chord) => chord
      .split('+')
      .map((token) => token === 'mod' ? (apple ? 'meta' : 'ctrl') : token)
      .join('+'))
    .join('>');
}

export function resolveKeybinding(
  id: KeybindingCommandId,
  overrides: KeybindingOverrides,
): string | null {
  if (Object.prototype.hasOwnProperty.call(overrides, id)) {
    return overrides[id] ?? null;
  }
  return getKeybindingCommand(id).defaultBinding;
}

const KEY_LABELS: Record<string, string> = {
  alt: 'Alt',
  backquote: '`',
  ctrl: 'Ctrl',
  down: '↓',
  enter: 'Enter',
  escape: 'Esc',
  left: '←',
  meta: '⌘',
  right: '→',
  shift: 'Shift',
  up: '↑',
};

export function formatKeybinding(binding: string, apple = isApplePlatform()): string {
  return resolvePlatformBinding(binding, apple)
    .split('>')
    .map((chord) => chord
      .split('+')
      .map((token) => KEY_LABELS[token] ?? token.toUpperCase())
      .join(' + '))
    .join(', ');
}

export function bindingFromRecordedKeys(keys: ReadonlySet<string>, apple = isApplePlatform()): string | null {
  const normalized = Array.from(keys, normalizeKeyToken);
  const platformModifier = apple ? 'meta' : 'ctrl';
  const portable = normalized.map((token) => token === platformModifier ? 'mod' : token);
  return normalizeKeybinding(portable.join('+'));
}

export function findKeybindingConflict(
  id: KeybindingCommandId,
  binding: string,
  overrides: KeybindingOverrides,
  apple = isApplePlatform(),
): KeybindingCommand | null {
  const platformBinding = resolvePlatformBinding(binding, apple);
  return KEYBINDING_COMMANDS.find((command) => {
    if (command.id === id) return false;
    const effective = resolveKeybinding(command.id, overrides);
    return effective !== null && resolvePlatformBinding(effective, apple) === platformBinding;
  }) ?? null;
}

export function isReservedBrowserBinding(binding: string, apple = isApplePlatform()): boolean {
  const platformBinding = resolvePlatformBinding(binding, apple);
  const reserved = apple
    ? ['meta+l', 'meta+n', 'meta+q', 'meta+r', 'meta+t', 'meta+w']
    : ['ctrl+l', 'ctrl+n', 'ctrl+r', 'ctrl+t', 'ctrl+w'];
  return reserved.includes(platformBinding);
}

export function parseStoredKeybindingSettings(value: unknown): StoredKeybindingSettings {
  const empty: StoredKeybindingSettings = { version: 1, overrides: {} };
  if (!value || typeof value !== 'object') return empty;
  const candidate = value as { version?: unknown; overrides?: unknown };
  if (candidate.version !== 1 || !candidate.overrides || typeof candidate.overrides !== 'object') {
    return empty;
  }

  const legacyCommands: Record<string, KeybindingCommandId> = {
    'navigation.sessions': 'dock.focusLeft',
    'navigation.files': 'dock.focusRight',
    'navigation.terminal': 'dock.focusBottom',
    'panel.closeFocused': 'dock.closeFocused',
    'pane.focus.1': 'tab.focus.1',
    'pane.focus.2': 'tab.focus.2',
    'pane.focus.3': 'tab.focus.3',
    'pane.focus.4': 'tab.focus.4',
    'pane.focus.5': 'tab.focus.5',
    'pane.focus.6': 'tab.focus.6',
    'pane.focusPrevious': 'tab.focusPrevious',
    'pane.focusNext': 'tab.focusNext',
  };
  const overrides: KeybindingOverrides = {};
  for (const [storedId, binding] of Object.entries(candidate.overrides)) {
    const id = legacyCommands[storedId] ?? storedId;
    if (storedId !== id && Object.prototype.hasOwnProperty.call(candidate.overrides, id)) continue;
    if (!isKeybindingCommandId(id)) continue;
    if (binding === null) {
      overrides[id] = null;
      continue;
    }
    if (typeof binding !== 'string') continue;
    const normalized = normalizeKeybinding(binding);
    if (normalized) overrides[id] = normalized;
  }
  return { version: 1, overrides };
}
