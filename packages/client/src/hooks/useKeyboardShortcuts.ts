import { useHotkeys, type HotkeyCallback } from 'react-hotkeys-hook';
import {
  getKeybindingCommand,
  resolveKeybinding,
  resolvePlatformBinding,
  type KeybindingCommandId,
  type KeybindingOverrides,
} from '@/lib/keybindings';
import { useKeybindingStore } from '@/stores/keybindingStore';

const DISABLED_HOTKEY = '__prokop_disabled_hotkey__';
const SEQUENCE_TIMEOUT_MS = 500;

export interface KeyboardShortcutsConfig {
  onOpenSidebar: () => void;
  onOpenTerminal: () => void;
  onOpenFilesPanel: () => void;
  onNewSession: () => void;
  onToggleViewMode: () => void;
  onCloseFocusedPanel: () => void;
  onFocusChatInput: () => void;
  onStopStreaming: () => void;
  onToggleAutoFollow: () => void;
  onFocusPane: (index: number) => void;
  onCyclePane: (direction: -1 | 1) => void;
}

function isModalDialogOpen(): boolean {
  const openDialogSelectors = [
    '[data-slot="dialog-overlay"][data-state="open"]',
    '[data-slot="dialog-content"][data-state="open"]',
    '[role="dialog"][data-state="open"]',
  ];

  for (const selector of openDialogSelectors) {
    if (document.querySelector(selector)) return true;
  }

  const dialogs = document.querySelectorAll('[role="dialog"]');
  for (const dialog of dialogs) {
    if (dialog instanceof HTMLElement && isElementVisible(dialog)) return true;
  }
  return false;
}

function isElementVisible(element: HTMLElement): boolean {
  if (!element.isConnected) return false;
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== 'none'
    && style.visibility !== 'hidden'
    && parseFloat(style.opacity) > 0
    && rect.width > 0
    && rect.height > 0;
}

function isChatInputFocused(): boolean {
  const active = document.activeElement;
  return Boolean(
    active?.hasAttribute?.('data-chat-input')
    || active?.closest?.('[data-chat-input="true"]'),
  );
}

function shouldIgnoreGlobalEvent(event: KeyboardEvent): boolean {
  return event.isComposing || event.repeat || isModalDialogOpen();
}

function useCommandHotkey(
  id: KeybindingCommandId,
  overrides: KeybindingOverrides,
  callback: HotkeyCallback,
  ignoreEventWhen = shouldIgnoreGlobalEvent,
): void {
  const command = getKeybindingCommand(id);
  const binding = resolveKeybinding(id, overrides);
  useHotkeys(
    binding ? resolvePlatformBinding(binding) : DISABLED_HOTKEY,
    callback,
    {
      enabled: binding !== null,
      enableOnFormTags: command.allowInInputs ?? false,
      enableOnContentEditable: command.allowInInputs ?? false,
      eventListenerOptions: { capture: true },
      ignoreEventWhen,
      preventDefault: true,
      sequenceTimeoutMs: SEQUENCE_TIMEOUT_MS,
    },
  );
}

export function useKeyboardShortcuts(config: KeyboardShortcutsConfig): void {
  const overrides = useKeybindingStore((state) => state.overrides);

  // Register the sequence first so its terminal key can suppress the single-Escape command.
  useCommandHotkey('chat.stopStreaming', overrides, (event, hotkey) => {
    if (
      event.isComposing
      || event.repeat
      || (hotkey.isSequence && (
        event.altKey
        || event.ctrlKey
        || event.metaKey
        || event.shiftKey
      ))
      || isModalDialogOpen()
      || !isChatInputFocused()
    ) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    config.onStopStreaming();
  });

  useCommandHotkey('chat.focusInput', overrides, (event) => {
    if (isChatInputFocused()) return;
    event.preventDefault();
    config.onFocusChatInput();
  });

  useCommandHotkey('panel.closeFocused', overrides, () => config.onCloseFocusedPanel());
  useCommandHotkey('navigation.sessions', overrides, () => config.onOpenSidebar());
  useCommandHotkey('navigation.files', overrides, () => config.onOpenFilesPanel());
  useCommandHotkey('navigation.terminal', overrides, () => config.onOpenTerminal());
  useCommandHotkey('navigation.overview', overrides, () => config.onToggleViewMode());
  useCommandHotkey('session.create', overrides, () => config.onNewSession());
  useCommandHotkey('chat.toggleAutoFollow', overrides, () => config.onToggleAutoFollow());

  useCommandHotkey('pane.focus.1', overrides, () => config.onFocusPane(0));
  useCommandHotkey('pane.focus.2', overrides, () => config.onFocusPane(1));
  useCommandHotkey('pane.focus.3', overrides, () => config.onFocusPane(2));
  useCommandHotkey('pane.focus.4', overrides, () => config.onFocusPane(3));
  useCommandHotkey('pane.focus.5', overrides, () => config.onFocusPane(4));
  useCommandHotkey('pane.focus.6', overrides, () => config.onFocusPane(5));
  useCommandHotkey('pane.focusPrevious', overrides, () => config.onCyclePane(-1));
  useCommandHotkey('pane.focusNext', overrides, () => config.onCyclePane(1));
}
