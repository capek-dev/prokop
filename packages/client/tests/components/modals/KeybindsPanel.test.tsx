import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { KeybindsPanel } from '@/components/modals/configuration/KeybindsPanel';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useKeybindingStore } from '@/stores/keybindingStore';

function recordControlShortcut(key: string, code: string): void {
  fireEvent.keyDown(document, {
    key: 'Control',
    code: 'ControlLeft',
    ctrlKey: true,
  });
  fireEvent.keyDown(document, {
    key,
    code,
    ctrlKey: true,
  });
}

describe('KeybindsPanel', () => {
  beforeEach(() => {
    localStorage.clear();
    useKeybindingStore.setState({ overrides: {} });
  });

  test('records and resets a custom shortcut', () => {
    render(<KeybindsPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Change New session' }));
    act(() => recordControlShortcut('k', 'KeyK'));

    expect(useKeybindingStore.getState().overrides['session.create']).toBe('mod+k');
    expect(screen.getByText('Ctrl + K')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reset New session' }));
    expect(useKeybindingStore.getState().overrides['session.create']).toBeUndefined();
  });

  test('records modified Escape without dismissing the settings dialog', () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Manage keyboard shortcuts</DialogDescription>
          <KeybindsPanel />
        </DialogContent>
      </Dialog>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Change New session' }));
    fireEvent.keyDown(document, {
      key: 'Escape',
      code: 'Escape',
      altKey: true,
    });

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(useKeybindingStore.getState().overrides['session.create']).toBe('alt+escape');
    expect(screen.getByText('Alt + Esc')).toBeInTheDocument();
  });

  test('records one Escape without dismissing the settings dialog', async () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Manage keyboard shortcuts</DialogDescription>
          <KeybindsPanel />
        </DialogContent>
      </Dialog>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Change Focus chat input' }));
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByText('Press Escape again for a sequence')).toBeInTheDocument();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 550));
    });
    expect(useKeybindingStore.getState().overrides['chat.focusInput']).toBe('escape');
    expect(screen.getAllByText('Esc').length).toBeGreaterThan(0);
  });

  test('records double Escape without dismissing the settings dialog', () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Manage keyboard shortcuts</DialogDescription>
          <KeybindsPanel />
        </DialogContent>
      </Dialog>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Change Stop streaming' }));
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(useKeybindingStore.getState().overrides['chat.stopStreaming']).toBe('escape>escape');
    expect(screen.getByText('Esc, Esc')).toBeInTheDocument();
  });

  test('supports explicitly unassigning a command', () => {
    render(<KeybindsPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Unset Open files panel' }));

    expect(useKeybindingStore.getState().overrides['navigation.files']).toBeNull();
    expect(screen.getByText('No shortcut')).toBeInTheDocument();
  });

  test('replaces a conflicting command only after confirmation', () => {
    render(<KeybindsPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Change New session' }));
    act(() => recordControlShortcut('1', 'Digit1'));

    expect(screen.getByRole('dialog')).toHaveTextContent('Replace existing shortcut?');
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }));

    expect(useKeybindingStore.getState().overrides).toMatchObject({
      'session.create': 'mod+1',
      'navigation.sessions': null,
    });
  });

  test('resets all overrides', () => {
    useKeybindingStore.setState({
      overrides: { 'session.create': 'alt+n', 'navigation.files': null },
    });
    render(<KeybindsPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Reset all' }));
    expect(useKeybindingStore.getState().overrides).toEqual({});
  });
});
