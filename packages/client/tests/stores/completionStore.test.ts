import { beforeEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'prokopai_unread_sessions';

async function freshStore() {
  vi.resetModules();
  return import('@/stores/completionStore');
}

describe('completionStore (finished, not seen)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('marks and clears a session', async () => {
    const { useCompletionStore, selectCompletionRecord } = await freshStore();
    useCompletionStore.getState().setCompletion('s1', { finishedAt: 1, failed: false });
    expect(selectCompletionRecord('s1')(useCompletionStore.getState())).toEqual({ finishedAt: 1, failed: false });
    useCompletionStore.getState().clearCompletion('s1');
    expect(selectCompletionRecord('s1')(useCompletionStore.getState())).toBeUndefined();
  });

  it('keeps unread marks across reloads', async () => {
    const first = await freshStore();
    first.useCompletionStore.getState().setCompletion('s1', { finishedAt: 5, failed: true });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({ s1: { finishedAt: 5, failed: true } });

    const reloaded = await freshStore();
    expect(reloaded.useCompletionStore.getState().completionState.get('s1')).toEqual({ finishedAt: 5, failed: true });
  });

  it('ignores clearing a session that is not marked', async () => {
    const { useCompletionStore } = await freshStore();
    const before = useCompletionStore.getState();
    useCompletionStore.getState().clearCompletion('missing');
    expect(useCompletionStore.getState()).toBe(before);
  });

  it('survives corrupt storage', async () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    const { useCompletionStore } = await freshStore();
    expect(useCompletionStore.getState().completionState.size).toBe(0);
  });
});
