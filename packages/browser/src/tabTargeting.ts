export interface TabTargetingApi {
  query(queryInfo: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]>;
  get(tabId: number): Promise<chrome.tabs.Tab>;
  sendMessage(tabId: number, message: unknown): Promise<unknown>;
}

interface DisplayModeResponse {
  standalone?: boolean;
}

export const chromeTabTargetingApi: TabTargetingApi = {
  query: (queryInfo) => chrome.tabs.query(queryInfo),
  get: (tabId) => chrome.tabs.get(tabId),
  sendMessage: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
};

async function isStandaloneTab(api: TabTargetingApi, tab: chrome.tabs.Tab): Promise<boolean> {
  if (tab.id == null) return false;

  try {
    const response = await api.sendMessage(tab.id, { type: 'get_display_mode' }) as DisplayModeResponse | undefined;
    return response?.standalone === true;
  } catch {
    // Restricted and still-loading pages cannot receive content-script messages.
    return false;
  }
}

export async function getStandaloneWindowIds(api: TabTargetingApi): Promise<Set<number>> {
  const activeTabs = await api.query({ active: true });
  const classifications = await Promise.all(
    activeTabs.map(async (tab) => ({
      windowId: tab.windowId,
      standalone: await isStandaloneTab(api, tab),
    })),
  );

  return new Set(
    classifications
      .filter(({ standalone }) => standalone)
      .map(({ windowId }) => windowId),
  );
}

export async function getEligibleTabs(
  api: TabTargetingApi,
  queryInfo: chrome.tabs.QueryInfo = {},
): Promise<chrome.tabs.Tab[]> {
  const [tabs, standaloneWindowIds] = await Promise.all([
    api.query(queryInfo),
    getStandaloneWindowIds(api),
  ]);
  return tabs.filter((tab) => !standaloneWindowIds.has(tab.windowId));
}

export async function resolveTargetTab(
  api: TabTargetingApi,
  tabId?: number,
): Promise<chrome.tabs.Tab> {
  if (tabId != null) {
    const tab = await api.get(tabId);
    if (await isStandaloneTab(api, tab)) {
      throw new Error('Standalone PWA tabs cannot be targeted');
    }
    return tab;
  }

  const activeTabs = await getEligibleTabs(api, { active: true });
  const target = activeTabs.sort(
    (left, right) => (right.lastAccessed ?? 0) - (left.lastAccessed ?? 0),
  )[0];

  if (!target) {
    throw new Error('No eligible browser tab found');
  }

  return target;
}

function isScreenshotSupportedUrl(url: string | undefined): boolean {
  return url?.startsWith('http://') === true || url?.startsWith('https://') === true;
}

export async function resolveScreenshotTargetTab(
  api: TabTargetingApi,
  tabId?: number,
): Promise<chrome.tabs.Tab> {
  if (tabId != null) {
    const tab = await resolveTargetTab(api, tabId);
    if (!isScreenshotSupportedUrl(tab.url)) {
      throw new Error('Screenshots are only supported for http:// and https:// pages');
    }
    return tab;
  }

  const tabs = await getEligibleTabs(api);
  const target = tabs
    .filter((tab) => isScreenshotSupportedUrl(tab.url))
    .sort((left, right) => (right.lastAccessed ?? 0) - (left.lastAccessed ?? 0))[0];

  if (!target) {
    throw new Error('No eligible http:// or https:// browser tab found for screenshot');
  }

  return target;
}

export async function resolveEligibleWindowId(
  api: TabTargetingApi,
  windowId?: number,
): Promise<number> {
  if (windowId == null) {
    return (await resolveTargetTab(api)).windowId;
  }

  const tabs = await getEligibleTabs(api, { windowId });
  if (tabs.length === 0) {
    throw new Error(`No eligible browser window found for windowId ${windowId}`);
  }
  return windowId;
}
