import { fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  useKeyboardShortcuts,
  type KeyboardShortcutsConfig,
} from '@/hooks/useKeyboardShortcuts';
import { useKeybindingStore } from '@/stores/keybindingStore';

function createConfig(): KeyboardShortcutsConfig {
  return {
    onOpenSidebar: vi.fn(),
    onOpenTerminal: vi.fn(),
    onOpenFilesPanel: vi.fn(),
    onNewSession: vi.fn(),
    onToggleViewMode: vi.fn(),
    onCloseFocusedPanel: vi.fn(),
    onFocusChatInput: vi.fn(),
    onStopStreaming: vi.fn(),
    onToggleAutoFollow: vi.fn(),
    onFocusPane: vi.fn(),
    onCyclePane: vi.fn(),
  };
}

function Harness({ config }: { config: KeyboardShortcutsConfig }) {
  useKeyboardShortcuts(config);
  return <textarea aria-label="Chat" data-chat-input="true" />;
}

function press(
  target: Element,
  key: string,
  code: string,
  modifiers: Partial<KeyboardEventInit> = {},
): void {
  fireEvent.keyDown(target, { key, code, ...modifiers });
  fireEvent.keyUp(target, { key, code, ...modifiers });
}

describe('useKeyboardShortcuts', () => {
  beforeEach(() => {
    localStorage.clear();
    useKeybindingStore.setState({ overrides: {} });
  });

  test('requires an exact modifier match', () => {
    const config = createConfig();
    render(<Harness config={config} />);

    press(document.body, 'n', 'KeyN', { ctrlKey: true, shiftKey: true });
    expect(config.onNewSession).not.toHaveBeenCalled();

    press(document.body, 'n', 'KeyN', { ctrlKey: true });
    expect(config.onNewSession).toHaveBeenCalledTimes(1);
  });

  test('reacts to custom bindings and explicit unassignment', () => {
    useKeybindingStore.setState({
      overrides: {
        'session.create': 'alt+n',
        'navigation.files': null,
      },
    });
    const config = createConfig();
    render(<Harness config={config} />);

    press(document.body, 'n', 'KeyN', { altKey: true });
    press(document.body, '2', 'Digit2', { ctrlKey: true });

    expect(config.onNewSession).toHaveBeenCalledTimes(1);
    expect(config.onOpenFilesPanel).not.toHaveBeenCalled();
  });

  test('dispatches pane commands with their arguments', () => {
    const config = createConfig();
    render(<Harness config={config} />);

    press(document.body, '3', 'Digit3', { altKey: true });
    press(document.body, 'ArrowLeft', 'ArrowLeft', { altKey: true, shiftKey: true });

    expect(config.onFocusPane).toHaveBeenCalledWith(2);
    expect(config.onCyclePane).toHaveBeenCalledWith(-1);
  });

  test('stops streaming once on double Escape in the chat input', () => {
    const config = createConfig();
    const { getByRole } = render(<Harness config={config} />);
    const input = getByRole('textbox');
    input.focus();

    press(input, 'Escape', 'Escape');
    press(input, 'Escape', 'Escape');

    expect(config.onStopStreaming).toHaveBeenCalledTimes(1);
    expect(config.onFocusChatInput).not.toHaveBeenCalled();
  });

  test('supports a customized chord for stopping streaming', () => {
    useKeybindingStore.setState({
      overrides: { 'chat.stopStreaming': 'alt+x' },
    });
    const config = createConfig();
    const { getByRole } = render(<Harness config={config} />);
    const input = getByRole('textbox');
    input.focus();

    press(input, 'x', 'KeyX', { altKey: true });

    expect(config.onStopStreaming).toHaveBeenCalledTimes(1);
  });

  test('does not dispatch application commands while a dialog is open', () => {
    const config = createConfig();
    render(
      <>
        <Harness config={config} />
        <div data-slot="dialog-content" data-state="open" />
      </>,
    );

    press(document.body, 'n', 'KeyN', { ctrlKey: true });
    expect(config.onNewSession).not.toHaveBeenCalled();
  });
});
