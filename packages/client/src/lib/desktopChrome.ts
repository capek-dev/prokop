/**
 * Browser behaviors that make the PWA read as a web page instead of an app.
 * Installed once from `main.tsx`; every guard yields to app handlers that
 * already called `preventDefault()`.
 */

/** Targets where the browser's own context menu is useful (copy, paste, open link). */
const NATIVE_CONTEXT_MENU_SELECTOR = [
  'input',
  'textarea',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[contenteditable="plaintext-only"]',
  'a[href]',
  'img',
  '[data-native-context-menu]',
].join(',');

function eventElement(event: Event): Element | null {
  const origin = event.composedPath()[0];
  if (origin instanceof Element) return origin;
  if (origin instanceof Node) return origin.parentElement;
  return null;
}

function hasSelectionAt(element: Element): boolean {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
  return selection.containsNode(element, true);
}

export function allowsNativeContextMenu(event: MouseEvent): boolean {
  if (event.shiftKey) return true;
  const element = eventElement(event);
  if (!element) return false;
  if (element.closest(NATIVE_CONTEXT_MENU_SELECTOR)) return true;
  return hasSelectionAt(element);
}

/** Read by the inline script in index.html; keep the key in sync. */
export const THEME_COLOR_STORAGE_KEY = 'prokopai-theme-color';

/** Resolve any CSS color (theme tokens are oklch) to an sRGB hex string. */
function toHex(color: string): string | null {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b, alpha] = context.getImageData(0, 0, 1, 1).data;
  if (alpha === 0) return null;
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Point `<meta name="theme-color">` at the current app background so the
 * installed window's title bar and control overlay match the theme.
 */
export function syncThemeColor(themeKey: string, retry = true): void {
  const background = getComputedStyle(document.body).backgroundColor;
  const hex = background ? toHex(background) : null;
  if (!hex) {
    // Stylesheet not applied yet (transparent body): measure again next frame.
    if (retry) requestAnimationFrame(() => syncThemeColor(themeKey, false));
    return;
  }
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', hex);
  // index.html reads this before first paint, so a reload starts with the
  // right title bar instead of relying on this later update being picked up.
  try {
    localStorage.setItem(THEME_COLOR_STORAGE_KEY, JSON.stringify({ key: themeKey, color: hex }));
  } catch {
    // Storage unavailable: the title bar still updates for this page load.
  }
}

/**
 * Ask the browser to keep the app's storage (offline shell, settings, drafts)
 * instead of evicting it under storage pressure like a website's. Installed
 * apps are usually granted without a prompt.
 */
export async function requestPersistentStorage(): Promise<void> {
  const storage = navigator.storage;
  if (!storage?.persist || !storage.persisted) return;
  try {
    if (!(await storage.persisted())) await storage.persist();
  } catch {
    // Unsupported or denied: storage stays best-effort.
  }
}

function hasFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes('Files') ?? false;
}

function onContextMenu(event: MouseEvent): void {
  if (event.defaultPrevented || allowsNativeContextMenu(event)) return;
  event.preventDefault();
}

function onDragOver(event: DragEvent): void {
  if (event.defaultPrevented || !hasFiles(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
}

function onDrop(event: DragEvent): void {
  if (event.defaultPrevented || !hasFiles(event)) return;
  event.preventDefault();
}

function onWheel(event: WheelEvent): void {
  if (event.ctrlKey && !event.defaultPrevented) event.preventDefault();
}

/** Returns a function that removes every guard (used by tests). */
export function installDesktopChrome(): () => void {
  // Right-click on chrome shows nothing unless a custom menu handles it.
  // Shift+right-click always reaches the browser menu (Inspect, etc).
  document.addEventListener('contextmenu', onContextMenu);
  // A file dropped outside a drop zone must not navigate the window to it.
  // Text drags keep their default so inputs still accept dropped text.
  document.addEventListener('dragover', onDragOver);
  document.addEventListener('drop', onDrop);
  // Ctrl+wheel and trackpad pinch would zoom the whole page. Keyboard zoom
  // (Cmd/Ctrl +/-) stays available as the app-level zoom.
  document.addEventListener('wheel', onWheel, { passive: false });
  return () => {
    document.removeEventListener('contextmenu', onContextMenu);
    document.removeEventListener('dragover', onDragOver);
    document.removeEventListener('drop', onDrop);
    document.removeEventListener('wheel', onWheel);
  };
}
