// =============================================================================
// ProkopaiBrowser Background Service Worker
//
// Main extension runtime:
// - Connects to Prokopai server on startup
// - Routes client_capability asks to the appropriate handler
// - Supports: active_tab_read, browser_dom_action, browser_navigate,
//             browser_screenshot, browser_discover_elements
// =============================================================================

import { BrowserClient } from './client';
import { getOrCreateClientId } from './storage';
import { getConfig } from './config';
import type {
  ActiveTabData,
  ConnectionState,
  DomActionParams,
  DomActionResult,
  NavigateParams,
  NavigateResult,
  DiscoverElementsResult,
  ElementInfo,
  TabManageParams,
  TabManageResult,
  TabInfo,
} from './types';

const MAX_TEXT_LENGTH = 50_000;
const RECONNECT_ALARM = 'prokopai-reconnect';
const RECONNECT_ALARM_PERIOD_MINUTES = 0.5; // 30 seconds
const INITIAL_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 60_000;

let browserClient: BrowserClient | null = null;
let connectionState: ConnectionState = 'disconnected';
let connectionError: string | null = null;
let reconnectAttempts = 0;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let intentionalDisconnect = false;

// ── Active Tab Reading ──────────────────────────────────────

async function readActiveTab(): Promise<ActiveTabData> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id) {
    throw new Error('No active tab found');
  }

  const title = tab.title ?? '';
  const url = tab.url ?? '';

  if (!tab.id) {
    throw new Error('Active tab has no ID');
  }

  let text: string;

  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: 'extract_visible_text',
    });
    text = response?.text ?? '';
  } catch {
    text = '[Could not extract text from this page]';
  }

  if (text.length > MAX_TEXT_LENGTH) {
    text = text.slice(0, MAX_TEXT_LENGTH) + '\n\n[... text truncated]';
  }

  return { title, url, text };
}

// ── DOM Action Execution ────────────────────────────────────

async function executeDomAction(params: DomActionParams): Promise<DomActionResult> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id) {
    return { success: false, error: 'No active tab found' };
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: 'dom_action',
      params,
    });
    return response as DomActionResult;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `DOM action failed: ${message}` };
  }
}

// ── Element Discovery ───────────────────────────────────────

async function discoverElements(): Promise<DiscoverElementsResult> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id) {
    return { elements: [] };
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: 'discover_elements',
    });
    return { elements: (response?.elements ?? []) as ElementInfo[] };
  } catch {
    return { elements: [] };
  }
}

// ── Page Navigation ─────────────────────────────────────────

async function navigateToUrl(params: NavigateParams): Promise<NavigateResult> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id) {
    return { success: false, url: '', title: '', error: 'No active tab found' };
  }

  const timeout = params.timeout ?? 10000;
  const waitForLoad = params.waitForLoad ?? true;

  try {
    if (waitForLoad) {
      // Navigate and wait for the page to finish loading
      await Promise.all([
        new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Navigation timed out')), timeout);
          chrome.tabs.update(tab.id!, { url: params.url }, (updatedTab) => {
            if (!updatedTab) {
              clearTimeout(timer);
              reject(new Error('Failed to navigate'));
              return;
            }

            // Listen for the tab to complete loading
            const listener = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
              if (updatedTabId === tab.id && changeInfo.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(listener);
                clearTimeout(timer);
                resolve();
              }
            };
            chrome.tabs.onUpdated.addListener(listener);
          });
        }),
      ]);
    } else {
      await chrome.tabs.update(tab.id, { url: params.url });
    }

    // Get updated tab info
    const updatedTab = await chrome.tabs.get(tab.id);
    return {
      success: true,
      url: updatedTab.url ?? params.url,
      title: updatedTab.title ?? '',
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, url: params.url, title: '', error: message };
  }
}

// ── Screenshot Capture ──────────────────────────────────────

async function captureScreenshot(): Promise<{ success: boolean; dataUrl: string; error?: string }> {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(chrome.windows.WINDOW_ID_CURRENT, {
      format: 'png',
      quality: 80,
    });
    return { success: true, dataUrl };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, dataUrl: '', error: message };
  }
}

// ── Tab Management ──────────────────────────────────────────

function toTabInfo(tab: chrome.tabs.Tab): TabInfo {
  return {
    id: tab.id!,
    index: tab.index,
    title: tab.title ?? '',
    url: tab.url ?? '',
    active: tab.active,
    windowId: tab.windowId,
  };
}

async function manageTab(params: TabManageParams): Promise<TabManageResult> {
  switch (params.action) {
    case 'list': {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      return { success: true, tabs: tabs.map(toTabInfo) };
    }

    case 'create': {
      const createProps: chrome.tabs.CreateProperties = {
        url: params.url ?? 'about:blank',
        active: params.active ?? true,
      };
      const tab = await chrome.tabs.create(createProps);
      return { success: true, createdTab: toTabInfo(tab) };
    }

    case 'close': {
      let tabId: number | undefined;

      if (params.tabId != null) {
        tabId = params.tabId;
      } else if (params.tabIndex != null) {
        const tabs = await chrome.tabs.query({ currentWindow: true, index: params.tabIndex });
        tabId = tabs[0]?.id;
      } else {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        tabId = activeTab?.id;
      }

      if (tabId == null) {
        return { success: false, error: 'No tab found to close' };
      }

      await chrome.tabs.remove(tabId);
      return { success: true, closedTabId: tabId };
    }

    case 'switch': {
      if (params.tabId != null) {
        const tab = await chrome.tabs.update(params.tabId, { active: true });
        return { success: true, switchedToTab: toTabInfo(tab) };
      }

      if (params.tabIndex != null) {
        const tabs = await chrome.tabs.query({ currentWindow: true, index: params.tabIndex });
        const target = tabs[0];
        if (!target?.id) {
          return { success: false, error: `No tab at index ${params.tabIndex}` };
        }
        const tab = await chrome.tabs.update(target.id, { active: true });
        return { success: true, switchedToTab: toTabInfo(tab) };
      }

      return { success: false, error: 'Provide tabId or tabIndex to switch' };
    }

    default:
      return { success: false, error: `Unknown tab action: ${params.action}` };
  }
}

// ── Connection Lifecycle ────────────────────────────────────

function clearReconnectTimeout(): void {
  if (reconnectTimeout !== null) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
}

function scheduleReconnect(): void {
  if (intentionalDisconnect) return;

  clearReconnectTimeout();

  const delay = Math.min(
    INITIAL_RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempts),
    MAX_RECONNECT_DELAY_MS,
  );
  const jitter = delay * 0.2 * Math.random();
  const totalDelay = delay + jitter;

  reconnectAttempts++;
  console.log(`[browser] Reconnecting in ${Math.round(totalDelay)}ms (attempt ${reconnectAttempts})`);

  reconnectTimeout = setTimeout(() => {
    reconnectTimeout = null;
    connectToServer();
  }, totalDelay);
}

async function connectToServer(): Promise<void> {
  try {
    const [clientId, config] = await Promise.all([
      getOrCreateClientId(),
      getConfig(),
    ]);

    console.log('[browser] Connecting to:', config.serverUrl, 'clientId:', clientId);

    connectionState = 'connecting';
    connectionError = null;

    browserClient = new BrowserClient();

    browserClient.onAskRequest(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (sessionId: string, toolCallId: string, toolName: string, ask: any, requestId?: string) => {
        await handleAskRequest(sessionId, toolCallId, toolName, ask, requestId);
      },
    );

    browserClient.onDisconnected((_code, _reason, _wasClean) => {
      if (!intentionalDisconnect) {
        console.log('[browser] Unexpected disconnect, scheduling reconnect');
        scheduleReconnect();
      }
    });

    await browserClient.connect(config, clientId);
    connectionState = 'connected';
    connectionError = null;
    reconnectAttempts = 0;
    console.log('[browser] Connected and registered successfully');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[browser] Failed to connect:', message);
    connectionState = 'error';
    connectionError = message;
    browserClient = null;
    scheduleReconnect();
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AskPayload = any;

async function handleAskRequest(
  _sessionId: string,
  toolCallId: string,
  _toolName: string,
  ask: AskPayload,
  requestId?: string,
): Promise<void> {
  if (!browserClient) return;

  if (ask?.type !== 'client_capability') return;

  const capability = ask?.capability as string;

  try {
    switch (capability) {
      case 'active_tab_read': {
        const tabData = await readActiveTab();
        browserClient.sendAskResponse(toolCallId, {
          type: 'client_capability',
          capability,
          result: tabData,
        }, requestId);
        break;
      }

      case 'browser_dom_action': {
        const params = (ask?.params ?? ask?.metadata?.params) as DomActionParams;
        if (!params?.action) {
          browserClient.sendAskResponse(toolCallId, {
            type: 'client_capability',
            capability,
            result: { success: false, error: 'Missing action parameter' },
          }, requestId);
          break;
        }
        const result = await executeDomAction(params);
        browserClient.sendAskResponse(toolCallId, {
          type: 'client_capability',
          capability,
          result,
        }, requestId);
        break;
      }

      case 'browser_navigate': {
        const params = (ask?.params ?? ask?.metadata?.params) as NavigateParams;
        if (!params?.url) {
          browserClient.sendAskResponse(toolCallId, {
            type: 'client_capability',
            capability,
            result: { success: false, url: '', title: '', error: 'Missing URL parameter' },
          }, requestId);
          break;
        }
        const result = await navigateToUrl(params);
        browserClient.sendAskResponse(toolCallId, {
          type: 'client_capability',
          capability,
          result,
        }, requestId);
        break;
      }

      case 'browser_screenshot': {
        const result = await captureScreenshot();
        browserClient.sendAskResponse(toolCallId, {
          type: 'client_capability',
          capability,
          result,
        }, requestId);
        break;
      }

      case 'browser_discover_elements': {
        const result = await discoverElements();
        browserClient.sendAskResponse(toolCallId, {
          type: 'client_capability',
          capability,
          result,
        }, requestId);
        break;
      }

      case 'browser_tab_manage': {
        const params = (ask?.params ?? ask?.metadata?.params) as TabManageParams;
        if (!params?.action) {
          browserClient.sendAskResponse(toolCallId, {
            type: 'client_capability',
            capability,
            result: { success: false, error: 'Missing action parameter' },
          }, requestId);
          break;
        }
        const result = await manageTab(params);
        browserClient.sendAskResponse(toolCallId, {
          type: 'client_capability',
          capability,
          result,
        }, requestId);
        break;
      }

      default:
        console.warn('[browser] Unknown capability:', capability);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[browser] Ask handling failed:', message);

    browserClient.sendAskResponse(toolCallId, {
      type: 'client_capability',
      capability,
      result: { error: message },
    }, requestId);
  }
}

// ── Popup Message Handling ──────────────────────────────────

function getCurrentConfig(): Promise<{ serverUrl: string; token?: string }> {
  return getConfig();
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'getState') {
    getCurrentConfig().then((config) => {
      sendResponse({
        state: connectionState,
        error: connectionState === 'error' ? connectionError : undefined,
        serverUrl: config.serverUrl,
        token: config.token ?? '',
      });
    });
    return true; // async response
  }

  if (message.type === 'connect') {
    const { serverUrl, token } = message as { serverUrl: string; token?: string };
    intentionalDisconnect = false;
    clearReconnectTimeout();
    // Save config first, then connect
    chrome.storage.local.set(
      { prokopai_browser_config: { serverUrl, token: token || undefined } },
      () => {
        if (browserClient) {
          browserClient.disconnect().then(() => {
            browserClient = null;
            connectToServer().then(() => {
              sendResponse({ state: connectionState, error: connectionState === 'error' ? connectionError : undefined });
            });
          });
        } else {
          connectToServer().then(() => {
            sendResponse({ state: connectionState, error: connectionState === 'error' ? connectionError : undefined });
          });
        }
      },
    );
    return true; // async response
  }

  if (message.type === 'disconnect') {
    intentionalDisconnect = true;
    clearReconnectTimeout();
    connectionState = 'disconnected';
    connectionError = null;
    if (browserClient) {
      browserClient.disconnect().then(() => {
        browserClient = null;
        sendResponse({ state: 'disconnected' });
      });
    } else {
      sendResponse({ state: 'disconnected' });
    }
    return true; // async response
  }
});

// ── Extension Lifecycle ─────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  console.log('[browser] Extension installed');
  intentionalDisconnect = false;
  connectToServer();
});

chrome.runtime.onStartup.addListener(() => {
  console.log('[browser] Browser startup');
  intentionalDisconnect = false;
  connectToServer();
});

// Periodic alarm to keep service worker alive and ensure connection
chrome.alarms.create(RECONNECT_ALARM, {
  periodInMinutes: RECONNECT_ALARM_PERIOD_MINUTES,
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RECONNECT_ALARM) {
    if (!browserClient?.connected && !intentionalDisconnect) {
      console.log('[browser] Health check: disconnected, reconnecting');
      clearReconnectTimeout();
      connectToServer();
    }
  }
});

// Graceful cleanup before service worker is terminated
chrome.runtime.onSuspend.addListener(() => {
  console.log('[browser] Service worker suspending');
  clearReconnectTimeout();
  if (browserClient) {
    browserClient.disconnect();
    browserClient = null;
  }
  connectionState = 'disconnected';
});
