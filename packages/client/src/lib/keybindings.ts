export type KeybindingCommandId =
  | 'navigation.sessions'
  | 'navigation.files'
  | 'navigation.terminal'
  | 'navigation.overview'
  | 'session.create'
  | 'panel.closeFocused'
  | 'chat.focusInput'
  | 'chat.stopStreaming'
  | 'chat.toggleAutoFollow'
  | 'pane.focus.1'
  | 'pane.focus.2'
  | 'pane.focus.3'
  | 'pane.focus.4'
  | 'pane.focus.5'
  | 'pane.focus.6'
  | 'pane.focusPrevious'
  | 'pane.focusNext'
  | 'editor.save'
  | 'editor.close';

export type KeybindingContext = 'global' | 'chat' | 'editor';

export interface KeybindingCommand {
  id: KeybindingCommandId;
  label: string;
  category: 'Navigation' | 'Chat' | 'Panes' | 'Editor';
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
  { id: 'navigation.sessions', label: 'Open session list', category: 'Navigation', defaultBinding: 'mod+1', context: 'global', allowInInputs: true },
  { id: 'navigation.files', label: 'Open files panel', category: 'Navigation', defaultBinding: 'mod+2', context: 'global', allowInInputs: true },
  { id: 'navigation.terminal', label: 'Open terminal', category: 'Navigation', defaultBinding: 'mod+t', context: 'global', allowInInputs: true },
  { id: 'navigation.overview', label: 'Toggle overview mode', category: 'Navigation', defaultBinding: 'mod+o', context: 'global', allowInInputs: true },
  { id: 'session.create', label: 'New session', category: 'Navigation', defaultBinding: 'mod+n', context: 'global', allowInInputs: true },
  { id: 'panel.closeFocused', label: 'Close focused panel', category: 'Navigation', defaultBinding: 'shift+escape', context: 'global', allowInInputs: true },
  { id: 'chat.focusInput', label: 'Focus chat input', category: 'Chat', defaultBinding: 'escape', context: 'global', allowInInputs: true },
  { id: 'chat.stopStreaming', label: 'Stop streaming', category: 'Chat', defaultBinding: 'escape>escape', context: 'chat', allowInInputs: true },
  { id: 'chat.toggleAutoFollow', label: 'Toggle follow/free mode', category: 'Chat', defaultBinding: 'mod+shift+f', context: 'global', allowInInputs: true },
  { id: 'pane.focus.1', label: 'Focus pane 1', category: 'Panes', defaultBinding: 'alt+1', context: 'global', allowInInputs: true },
  { id: 'pane.focus.2', label: 'Focus pane 2', category: 'Panes', defaultBinding: 'alt+2', context: 'global', allowInInputs: true },
  { id: 'pane.focus.3', label: 'Focus pane 3', category: 'Panes', defaultBinding: 'alt+3', context: 'global', allowInInputs: true },
  { id: 'pane.focus.4', label: 'Focus pane 4', category: 'Panes', defaultBinding: 'alt+4', context: 'global', allowInInputs: true },
  { id: 'pane.focus.5', label: 'Focus pane 5', category: 'Panes', defaultBinding: 'alt+5', context: 'global', allowInInputs: true },
  { id: 'pane.focus.6', label: 'Focus pane 6', category: 'Panes', defaultBinding: 'alt+6', context: 'global', allowInInputs: true },
  { id: 'pane.focusPrevious', label: 'Focus previous pane', category: 'Panes', defaultBinding: 'alt+shift+left', context: 'global', allowInInputs: true },
  { id: 'pane.focusNext', label: 'Focus next pane', category: 'Panes', defaultBinding: 'alt+shift+right', context: 'global', allowInInputs: true },
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

  const overrides: KeybindingOverrides = {};
  for (const [id, binding] of Object.entries(candidate.overrides)) {
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
