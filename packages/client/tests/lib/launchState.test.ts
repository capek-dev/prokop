import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  installLaunchQueue,
  lastLocationFor,
  parseLaunchAction,
  recordLocation,
  requestLaunchAction,
  resumeLocation,
  subscribeLaunchActions,
  takeLaunchAction,
} from '@/lib/launchState';

const WORKSPACE = '/server/s1/workspace/session/abc?open=abc%2Cdef';

describe('launchState', () => {
  beforeEach(() => {
    localStorage.clear();
    takeLaunchAction(() => true);
  });

  afterEach(() => {
    delete (window as Window & { launchQueue?: unknown }).launchQueue;
  });

  it('parses only known shortcut actions', () => {
    expect(parseLaunchAction('?action=new-session')).toBe('new-session');
    expect(parseLaunchAction('?action=overview')).toBe('overview');
    expect(parseLaunchAction('?action=delete-everything')).toBeNull();
    expect(parseLaunchAction('')).toBeNull();
  });

  it('remembers workspace and overview locations per server, nothing else', () => {
    recordLocation(WORKSPACE);
    recordLocation('/server/s2/overview');
    recordLocation('/pair?code=1');
    recordLocation('/');
    expect(lastLocationFor('s1')).toBe(WORKSPACE);
    expect(lastLocationFor('s2')).toBe('/server/s2/overview');
    expect(lastLocationFor('s3')).toBeNull();
  });

  it('resumes bare entry points and leaves specific locations alone', () => {
    recordLocation(WORKSPACE);
    expect(resumeLocation('/', '', 's1')).toBe(WORKSPACE);
    expect(resumeLocation('/', '?action=overview', 's1')).toBe(WORKSPACE);
    expect(resumeLocation('/server/s1', '', null)).toBe(WORKSPACE);
    expect(resumeLocation('/server/s1/workspace', '', null)).toBe(WORKSPACE);
    expect(resumeLocation('/server/s1/overview', '', null)).toBeNull();
    expect(resumeLocation('/', '?select=true', 's1')).toBeNull();
    expect(resumeLocation('/', '', null)).toBeNull();
    expect(resumeLocation('/server/s9', '', null)).toBeNull();
  });

  it('keeps an action pending until the shell can run it', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeLaunchActions(listener);
    requestLaunchAction('new-session');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(takeLaunchAction(() => false)).toBeNull();
    expect(takeLaunchAction(() => true)).toBe('new-session');
    expect(takeLaunchAction(() => true)).toBeNull();
    unsubscribe();
  });

  it('routes relaunches: focus only, run shortcut actions, navigate deep links', () => {
    let consumer: ((params: { targetURL?: string }) => void) | undefined;
    (window as Window & { launchQueue?: unknown }).launchQueue = {
      setConsumer: (fn: typeof consumer) => { consumer = fn; },
    };
    const navigate = vi.fn();
    installLaunchQueue(navigate);
    const origin = location.origin;

    consumer!({ targetURL: `${origin}/` });
    expect(navigate).not.toHaveBeenCalled();

    consumer!({ targetURL: `${origin}/?action=overview` });
    expect(navigate).not.toHaveBeenCalled();
    expect(takeLaunchAction(() => true)).toBe('overview');

    consumer!({ targetURL: `${origin}/server/s1/overview` });
    expect(navigate).toHaveBeenCalledWith('/server/s1/overview');

    consumer!({ targetURL: 'https://elsewhere.example/server/s1/overview' });
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});
