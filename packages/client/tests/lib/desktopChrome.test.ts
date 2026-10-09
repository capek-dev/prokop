import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installDesktopChrome, requestPersistentStorage, syncThemeColor, THEME_COLOR_STORAGE_KEY } from '@/lib/desktopChrome';

/** happy-dom has no canvas; paint every color as the given RGBA pixel. */
function stubCanvas(pixel: [number, number, number, number]) {
  // happy-dom computes no styles; any non-empty background reaches the canvas.
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({ backgroundColor: 'oklch(0.165 0.014 265)' } as CSSStyleDeclaration);
  const create = document.createElement.bind(document);
  return vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => tag === 'canvas'
    ? { getContext: () => ({ fillStyle: '', fillRect: () => {}, getImageData: () => ({ data: pixel }) }) }
    : create(tag)) as typeof document.createElement);
}

describe('syncThemeColor', () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(() => {
    localStorage.clear();
    document.head.querySelector('meta[name="theme-color"]')?.remove();
  });

  it('sets the title bar color and saves it for the next load', () => {
    const spy = stubCanvas([20, 22, 27, 255]);
    try {
      syncThemeColor('dark.neutral');
      expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#14161b');
      expect(JSON.parse(localStorage.getItem(THEME_COLOR_STORAGE_KEY)!)).toEqual({ key: 'dark.neutral', color: '#14161b' });
    } finally {
      spy.mockRestore();
    }
  });

  it('waits a frame instead of saving a color for an unstyled page', () => {
    const spy = stubCanvas([0, 0, 0, 0]);
    const frame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0);
    try {
      syncThemeColor('dark.neutral');
      expect(frame).toHaveBeenCalledTimes(1);
      expect(localStorage.getItem(THEME_COLOR_STORAGE_KEY)).toBeNull();
    } finally {
      spy.mockRestore();
      frame.mockRestore();
    }
  });
});

describe('requestPersistentStorage', () => {
  it('asks once when storage is not yet persistent, and never when it is', async () => {
    const persist = vi.fn().mockResolvedValue(true);
    const persisted = vi.fn().mockResolvedValue(false);
    // happy-dom has no StorageManager; model the Chromium one.
    Object.defineProperty(navigator, 'storage', { configurable: true, value: { persist, persisted } });
    try {
      await requestPersistentStorage();
      expect(persist).toHaveBeenCalledTimes(1);
      persisted.mockResolvedValue(true);
      await requestPersistentStorage();
      expect(persist).toHaveBeenCalledTimes(1);
    } finally {
      delete (navigator as { storage?: unknown }).storage;
    }
  });
});

function rightClick(target: Element, init: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, composed: true, ...init });
  target.dispatchEvent(event);
  return event;
}

describe('installDesktopChrome', () => {
  let uninstall: () => void;

  beforeEach(() => {
    uninstall = installDesktopChrome();
  });

  afterEach(() => {
    uninstall();
    window.getSelection()?.removeAllRanges();
    document.body.innerHTML = '';
  });

  it('suppresses the browser context menu on app chrome', () => {
    document.body.innerHTML = '<nav><button>Sessions</button></nav>';
    expect(rightClick(document.querySelector('button')!).defaultPrevented).toBe(true);
  });

  it('keeps the browser context menu on editable fields and links', () => {
    document.body.innerHTML = '<input /><textarea></textarea><a href="https://example.com">link</a>';
    for (const element of document.body.children) {
      expect(rightClick(element).defaultPrevented).toBe(false);
    }
  });

  it('keeps the browser context menu on selected text only', () => {
    document.body.innerHTML = '<p>copy me</p><span>chrome</span>';
    const paragraph = document.querySelector('p')!;
    // happy-dom's Selection.containsNode is a stub; model a real selection.
    const selection = {
      isCollapsed: false,
      rangeCount: 1,
      containsNode: (node: Node) => node === paragraph,
    } as unknown as Selection;
    const spy = vi.spyOn(window, 'getSelection').mockReturnValue(selection);
    try {
      expect(rightClick(paragraph).defaultPrevented).toBe(false);
      expect(rightClick(document.querySelector('span')!).defaultPrevented).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('always allows Shift+right-click', () => {
    document.body.innerHTML = '<div>chrome</div>';
    expect(rightClick(document.querySelector('div')!, { shiftKey: true }).defaultPrevented).toBe(false);
  });

  it('leaves custom context menus in charge', () => {
    document.body.innerHTML = '<div>row</div>';
    const row = document.querySelector('div')!;
    let handled = false;
    row.addEventListener('contextmenu', (event) => { event.preventDefault(); handled = true; });
    expect(rightClick(row).defaultPrevented).toBe(true);
    expect(handled).toBe(true);
  });

  it('stops Ctrl+wheel page zoom but not plain scrolling', () => {
    const zoom = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 10 });
    // happy-dom drops modifier keys from the WheelEvent init dictionary.
    Object.defineProperty(zoom, 'ctrlKey', { value: true });
    const scroll = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 10 });
    document.body.dispatchEvent(zoom);
    document.body.dispatchEvent(scroll);
    expect(zoom.defaultPrevented).toBe(true);
    expect(scroll.defaultPrevented).toBe(false);
  });
});
