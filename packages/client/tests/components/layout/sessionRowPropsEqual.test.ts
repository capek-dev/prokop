import { describe, expect, it } from 'vitest';
import type { Session } from '@prokopai/sdk';
import {
  sessionRowPropsEqual,
  type ChildrenMap,
  type SessionDerivedValuesMap,
  type SessionMenuButtonProps,
} from '@/components/layout/SessionMenuButton';

const noop = () => {};
const row = { id: 'row' } as Session;
const child = { id: 'child' } as Session;

function props(overrides: Partial<SessionMenuButtonProps> = {}): SessionMenuButtonProps {
  return {
    session: row,
    childrenMap: new Map(),
    sessionDerivedValues: new Map([['row', { isStreaming: false, hasPendingPermission: false, isRunning: false }]]),
    isActive: false,
    currentSessionId: 'a',
    onResumeSession: noop,
    onCloseSession: noop,
    onReopenSession: noop,
    onDeleteSession: noop,
    onRename: noop,
    ...overrides,
  };
}

describe('sessionRowPropsEqual', () => {
  it('skips a row when only other sessions changed', () => {
    const prev = props();
    const next = props({
      currentSessionId: 'b',
      childrenMap: new Map([['other', [child]]]),
      sessionDerivedValues: new Map([
        ['row', { isStreaming: false, hasPendingPermission: false, isRunning: false }],
        ['other', { isStreaming: true, hasPendingPermission: false, isRunning: true }],
      ]),
    });
    expect(sessionRowPropsEqual(prev, next)).toBe(true);
  });

  it('re-renders when the row becomes active or its status changes', () => {
    const prev = props();
    expect(sessionRowPropsEqual(prev, props({ isActive: true }))).toBe(false);
    const running: SessionDerivedValuesMap = new Map([['row', { isStreaming: true, hasPendingPermission: false, isRunning: true }]]);
    expect(sessionRowPropsEqual(prev, props({ sessionDerivedValues: running }))).toBe(false);
  });

  it('re-renders a parent row when anything below it may have changed', () => {
    const childrenMap: ChildrenMap = new Map([['row', [child]]]);
    const prev = props({ childrenMap });
    expect(sessionRowPropsEqual(prev, props({ childrenMap, currentSessionId: 'child' }))).toBe(false);
    expect(sessionRowPropsEqual(prev, props({ childrenMap: new Map([['row', [{ id: 'child' } as Session]]]) }))).toBe(false);
  });
});
