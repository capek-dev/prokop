import { describe, expect, test } from 'vitest';
import {
  getCreateSessionOptions,
  getSessionCreateBoardAction,
} from '@/lib/sessionCreate';

describe('session creation board behavior', () => {
  test('plain click replaces the focused pane', () => {
    const options = getCreateSessionOptions({ metaKey: false, ctrlKey: false });

    expect(options).toEqual({ openAlongside: false });
    expect(getSessionCreateBoardAction(options)).toBe('replace-focused');
  });

  test('Command-click opens the new session alongside', () => {
    const options = getCreateSessionOptions({ metaKey: true, ctrlKey: false });

    expect(options).toEqual({ openAlongside: true });
    expect(getSessionCreateBoardAction(options)).toBe('open-alongside');
  });

  test('Control-click opens the new session alongside', () => {
    const options = getCreateSessionOptions({ metaKey: false, ctrlKey: true });

    expect(options).toEqual({ openAlongside: true });
    expect(getSessionCreateBoardAction(options)).toBe('open-alongside');
  });
});
