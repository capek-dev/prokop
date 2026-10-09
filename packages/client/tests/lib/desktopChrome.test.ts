import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installDesktopChrome } from '@/lib/desktopChrome';

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
