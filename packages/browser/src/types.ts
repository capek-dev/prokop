// =============================================================================
// Prokop Browser Types
// =============================================================================

export interface ActiveTabData {
  title: string;
  url: string;
  text: string;
}

export interface BrowserTargetParams {
  tabId?: number;
}

export interface DomActionParams extends BrowserTargetParams {
  action: 'click' | 'type' | 'select' | 'clear' | 'scroll' | 'hover' | 'press_enter' | 'check' | 'uncheck';
  selector?: string;
  text?: string;
  value?: string;
  x?: number;
  y?: number;
  delay?: number;
}

export interface BoundingRect {
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface DomActionResult {
  success: boolean;
  error?: string;
  elementFound?: boolean;
  currentValue?: string;
  pageChanged?: boolean;
  scrollX?: number;
  scrollY?: number;
  viewportWidth?: number;
  viewportHeight?: number;
}

export interface NavigateParams extends BrowserTargetParams {
  url: string;
  waitForLoad?: boolean;
  timeout?: number;
}

export interface NavigateResult {
  success: boolean;
  url: string;
  title: string;
  error?: string;
}

export interface DiscoverElementsResult {
  elements: ElementInfo[];
}

export interface ElementInfo {
  tag: string;
  id?: string;
  className?: string;
  type?: string;
  placeholder?: string;
  text?: string;
  href?: string;
  value?: string;
  selector: string;
  role?: string;
  ariaLabel?: string;
  boundingRect?: BoundingRect;
  isVisible?: boolean;
  isInViewport?: boolean;
}

export interface ScreenshotResult {
  success: boolean;
  dataUrl: string;
  error?: string;
}

// ── Tab Management ───────────────────────────────────────────

export type TabAction = 'list' | 'create' | 'close' | 'switch';

export interface TabManageParams {
  action: TabAction;
  url?: string;
  tabIndex?: number;
  tabId?: number;
  windowId?: number;
  active?: boolean;
}

export interface TabInfo {
  id: number;
  index: number;
  title: string;
  url: string;
  active: boolean;
  windowId: number;
}

export interface TabManageResult {
  success: boolean;
  error?: string;
  tabs?: TabInfo[];
  createdTab?: TabInfo;
  closedTabId?: number;
  switchedToTab?: TabInfo;
}

// ── Config ───────────────────────────────────────────────────

export interface ExtensionConfig {
  serverUrl: string;
  token?: string;
}

export const STORAGE_KEYS = {
  CLIENT_ID: 'prokopai_browser_client_id',
  CONFIG: 'prokopai_browser_config',
} as const;

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export const DEFAULT_CONFIG: ExtensionConfig = {
  serverUrl: 'http://localhost:8742',
};
