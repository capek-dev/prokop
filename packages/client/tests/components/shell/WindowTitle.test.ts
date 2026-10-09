import { describe, expect, it } from 'vitest';
import { APP_TITLE, formatWindowTitle } from '@/components/shell/WindowTitle';

describe('formatWindowTitle', () => {
  it('names the window after the session and workspace', () => {
    expect(formatWindowTitle({ sessionTitle: 'Fix login', workspaceName: 'jean2', active: false })).toBe('Fix login · jean2');
  });

  it('falls back to the workspace, then the app name', () => {
    expect(formatWindowTitle({ sessionTitle: null, workspaceName: 'jean2', active: false })).toBe('jean2');
    expect(formatWindowTitle({ active: false })).toBe(APP_TITLE);
  });

  it('marks a window whose agent works or waits for an answer', () => {
    expect(formatWindowTitle({ sessionTitle: 'Fix login', workspaceName: 'jean2', active: true })).toBe('● Fix login · jean2');
  });
});
