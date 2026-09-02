import { describe, expect, test } from 'bun:test';

import {
  getEligibleTabs,
  resolveEligibleWindowId,
  resolveTargetTab,
} from './tabTargeting';
import type { TabTargetingApi } from './tabTargeting';

function tab(
  id: number,
  windowId: number,
  active: boolean,
  lastAccessed: number,
): chrome.tabs.Tab {
  return {
    id,
    windowId,
    active,
    lastAccessed,
    index: 0,
    pinned: false,
    highlighted: active,
    incognito: false,
    selected: active,
    discarded: false,
    autoDiscardable: true,
    groupId: -1,
  };
}

function createApi(tabs: chrome.tabs.Tab[], standaloneTabIds: number[]): TabTargetingApi {
  return {
    query: async (queryInfo) => tabs.filter((candidate) =>
      (queryInfo.active == null || candidate.active === queryInfo.active) &&
      (queryInfo.windowId == null || candidate.windowId === queryInfo.windowId),
    ),
    get: async (tabId) => {
      const candidate = tabs.find(({ id }) => id === tabId);
      if (!candidate) throw new Error(`Unknown tab ${tabId}`);
      return candidate;
    },
    sendMessage: async (tabId) => ({ standalone: standaloneTabIds.includes(tabId) }),
  };
}

describe('browser tab targeting', () => {
  test('lists tabs across browser windows and excludes standalone PWA windows', async () => {
    const tabs = [
      tab(1, 10, true, 100),
      tab(2, 10, false, 90),
      tab(3, 20, true, 200),
      tab(4, 30, true, 150),
    ];
    const api = createApi(tabs, [3]);

    expect((await getEligibleTabs(api)).map(({ id }) => id)).toEqual([1, 2, 4]);
  });

  test('defaults to the most recently accessed active browser tab', async () => {
    const tabs = [
      tab(1, 10, true, 100),
      tab(2, 20, true, 300),
      tab(3, 30, true, 200),
    ];
    const api = createApi(tabs, [2]);

    expect((await resolveTargetTab(api)).id).toBe(3);
  });

  test('rejects an explicitly targeted standalone PWA tab', async () => {
    const api = createApi([tab(7, 70, true, 100)], [7]);

    await expect(resolveTargetTab(api, 7)).rejects.toThrow('Standalone PWA tabs cannot be targeted');
  });

  test('rejects a standalone PWA window for index-based actions', async () => {
    const api = createApi([
      tab(1, 10, true, 100),
      tab(2, 20, true, 200),
    ], [2]);

    await expect(resolveEligibleWindowId(api, 20)).rejects.toThrow('No eligible browser window found');
  });
});
