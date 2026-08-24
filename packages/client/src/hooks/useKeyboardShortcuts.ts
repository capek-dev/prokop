import { useEffect, useLayoutEffect, useRef } from 'react';

const DOUBLE_ESCAPE_WINDOW_MS = 400;

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
    if (document.querySelector(selector)) {
      return true;
    }
  }

  const dialogs = document.querySelectorAll('[role="dialog"]');
  for (const dialog of dialogs) {
    if (dialog instanceof HTMLElement && isElementVisible(dialog)) {
      return true;
    }
  }

  return false;
}

function isElementVisible(el: HTMLElement): boolean {
  if (!el.isConnected) return false;
  const style = window.getComputedStyle(el);
  return (
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    parseFloat(style.opacity) > 0 &&
    el.getBoundingClientRect().width > 0 &&
    el.getBoundingClientRect().height > 0
  );
}

function isChatInputFocused(): boolean {
  const active = document.activeElement;
  if (!active) return false;

  if (active.hasAttribute?.('data-chat-input')) {
    return true;
  }

  if (active.closest?.('[data-chat-input="true"]')) {
    return true;
  }

  return false;
}

export function useKeyboardShortcuts(config: KeyboardShortcutsConfig): void {
  const configRef = useRef(config);
  useLayoutEffect(() => {
    configRef.current = config;
  });

  const escapeStateRef = useRef({ lastEscTime: 0, armed: false });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing) {
        return;
      }

      if (e.repeat) {
        return;
      }

      if (e.key === 'Escape' && isModalDialogOpen()) {
        return;
      }

      const {
        onCloseFocusedPanel,
        onFocusChatInput,
        onStopStreaming,
        onOpenSidebar,
        onOpenTerminal,
        onOpenFilesPanel,
        onNewSession,
        onToggleViewMode,
        onToggleAutoFollow,
        onFocusPane,
        onCyclePane,
      } = configRef.current;

      if (e.shiftKey && e.key === 'Escape') {
        e.preventDefault();
        onCloseFocusedPanel();
        return;
      }

      if (e.key === 'Escape' && !e.metaKey && !e.ctrlKey) {
        const chatFocused = isChatInputFocused();
        const now = Date.now();
        const { lastEscTime, armed } = escapeStateRef.current;
        const timeSinceLastEsc = now - lastEscTime;

        if (chatFocused && armed && timeSinceLastEsc < DOUBLE_ESCAPE_WINDOW_MS) {
          e.preventDefault();
          escapeStateRef.current = { lastEscTime: 0, armed: false };
          onStopStreaming();
          return;
        }

        if (chatFocused) {
          escapeStateRef.current = { lastEscTime: now, armed: true };
          return;
        }

        e.preventDefault();
        onFocusChatInput();
        return;
      }

      if (e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey && /^Digit[1-6]$/.test(e.code)) {
        e.preventDefault();
        onFocusPane(Number(e.code.slice(-1)) - 1);
        return;
      }

      if (e.altKey && e.shiftKey && !e.metaKey && !e.ctrlKey && e.code === 'ArrowLeft') {
        e.preventDefault();
        onCyclePane(-1);
        return;
      }

      if (e.altKey && e.shiftKey && !e.metaKey && !e.ctrlKey && e.code === 'ArrowRight') {
        e.preventDefault();
        onCyclePane(1);
        return;
      }

      const target = e.target as HTMLElement;
      const isInputElement =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable;

      const modifierPressed = e.metaKey || e.ctrlKey;

      if (isInputElement && !modifierPressed) {
        return;
      }

      if (modifierPressed && e.code === 'Digit1') {
        e.preventDefault();
        onOpenSidebar();
        return;
      }

      if (modifierPressed && e.code === 'KeyT') {
        e.preventDefault();
        onOpenTerminal();
        return;
      }

      if (modifierPressed && e.code === 'Digit2') {
        e.preventDefault();
        onOpenFilesPanel();
        return;
      }

      if (modifierPressed && e.code === 'KeyN') {
        e.preventDefault();
        onNewSession();
        return;
      }

      if (modifierPressed && e.code === 'KeyO') {
        e.preventDefault();
        onToggleViewMode();
        return;
      }

      if (modifierPressed && e.shiftKey && e.code === 'KeyF') {
        e.preventDefault();
        onToggleAutoFollow();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, []);
}
