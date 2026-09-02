// =============================================================================
// Content Script - Page interaction layer
//
// Handles two types of messages from the background service worker:
//   1. extract_visible_text — read the visible text on the page
//   2. dom_action           — perform a DOM interaction (click, type, select, etc.)
// =============================================================================

const MAX_TEXT_LENGTH = 50_000;
const TRUNCATION_SUFFIX = '\n\n[... text truncated]';

// ── Deep DOM Traversal (Shadow DOM + Iframe) ────────────────

function deepQuerySelectorAll(selector: string): Element[] {
  const results: Element[] = [];
  const visited = new Set<Node>();

  function traverse(root: Document | ShadowRoot): void {
    if (visited.has(root)) return;
    visited.add(root);

    for (const el of Array.from(root.querySelectorAll(selector))) {
      results.push(el);
    }

    for (const el of Array.from(root.querySelectorAll('*'))) {
      const htmlEl = el as HTMLElement;
      if (htmlEl.shadowRoot) {
        traverse(htmlEl.shadowRoot);
      }
      if (htmlEl.tagName === 'IFRAME') {
        try {
          const doc = (htmlEl as HTMLIFrameElement).contentDocument;
          if (doc) traverse(doc);
        } catch {
          // Cross-origin iframe - skip
        }
      }
    }
  }

  traverse(document);
  return results;
}

function deepQuerySelector(selector: string): Element | null {
  return deepQuerySelectorAll(selector)[0] ?? null;
}

// ── Visibility & Position Helpers ───────────────────────────

function isElementVisible(el: HTMLElement): boolean {
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') {
    return false;
  }
  if (parseFloat(style.opacity) === 0) {
    return false;
  }
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    return false;
  }
  if (el.offsetParent === null && style.position !== 'fixed') {
    return false;
  }
  return true;
}

function isElementInViewport(rect: DOMRect): boolean {
  const vw = window.innerWidth || document.documentElement.clientWidth;
  const vh = window.innerHeight || document.documentElement.clientHeight;
  return rect.top < vh && rect.bottom > 0 && rect.left < vw && rect.right > 0;
}

function getFixedHeaderHeight(): number {
  let maxBottom = 0;
  const candidates = document.querySelectorAll(
    'header, nav, [role="banner"], [class*="header"], [class*="nav"], [class*="sticky"], [style*="fixed"]',
  );
  for (const el of candidates) {
    const htmlEl = el as HTMLElement;
    const style = getComputedStyle(htmlEl);
    if (
      (style.position === 'fixed' || style.position === 'sticky') &&
      style.visibility !== 'hidden' &&
      style.display !== 'none'
    ) {
      const rect = htmlEl.getBoundingClientRect();
      if (rect.top <= 0 && rect.bottom > 0) {
        maxBottom = Math.max(maxBottom, rect.bottom);
      }
    }
  }
  return maxBottom;
}

interface BoundingRect {
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
}

function computeBoundingRect(rect: DOMRect): BoundingRect {
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    top: Math.round(rect.top),
    right: Math.round(rect.right),
    bottom: Math.round(rect.bottom),
    left: Math.round(rect.left),
  };
}

// ── Element Resolution ──────────────────────────────────────

function resolveElement(selector: string): Element | null {
  return deepQuerySelector(selector);
}

function escapeXPathString(str: string): string {
  if (!str.includes("'")) {
    return `'${str}'`;
  }
  if (!str.includes('"')) {
    return `"${str}"`;
  }
  const parts = str.split("'").map((part) => `'${part}'`);
  return `concat(${parts.join(", \"'\", ")})`;
}

function findElementByText(text: string, tag?: string): HTMLElement | null {
  const escapedText = escapeXPathString(text.toLowerCase());
  const xpath = tag
    ? `//${tag}[contains(translate(normalize-space(text()), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), ${escapedText})]`
    : `//*[contains(translate(normalize-space(text()), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), ${escapedText})]`;
  const result = document.evaluate(xpath, document.body, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
  return result.singleNodeValue as HTMLElement | null;
}

function findClickable(element: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = element;
  while (current) {
    const tag = current.tagName.toLowerCase();
    if (
      tag === 'a' ||
      tag === 'button' ||
      tag === 'select' ||
      current.getAttribute('role') === 'button' ||
      current.onclick !== null ||
      current.isContentEditable
    ) {
      return current;
    }
    if (getComputedStyle(current).cursor === 'pointer') {
      return current;
    }
    current = current.parentElement;
  }
  return element;
}

// ── DOM Actions ─────────────────────────────────────────────

interface DomActionParams {
  action: 'click' | 'type' | 'select' | 'clear' | 'scroll' | 'hover' | 'press_enter' | 'check' | 'uncheck';
  selector?: string;
  text?: string;
  value?: string;
  x?: number;
  y?: number;
  delay?: number;
}

interface DomActionResult {
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

function simulateClick(element: HTMLElement): void {
  const rect = element.getBoundingClientRect();
  const clientX = rect.left + rect.width / 2;
  const clientY = rect.top + rect.height / 2;

  const events = ['pointerdown', 'mousedown', 'mouseup', 'pointerup', 'click'];
  for (const eventType of events) {
    const isDown = eventType === 'pointerdown' || eventType === 'mousedown';
    const event = new MouseEvent(eventType, {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX,
      clientY,
      screenX: clientX,
      screenY: clientY,
      button: 0,
      buttons: isDown ? 1 : 0,
      detail: 1,
    });
    element.dispatchEvent(event);
  }
}

function simulateInput(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  element.focus();
  element.dispatchEvent(new FocusEvent('focus', { bubbles: true }));

  element.dispatchEvent(new InputEvent('beforeinput', {
    bubbles: true,
    cancelable: true,
    inputType: 'insertText',
    data: value,
  }));

  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set || Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value',
  )?.set;

  if (nativeInputValueSetter) {
    nativeInputValueSetter.call(element, value);
  } else {
    element.value = value;
  }

  element.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    cancelable: true,
    inputType: 'insertText',
    data: value,
  }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

function simulateKeyDown(element: HTMLElement, key: string): void {
  const event = new KeyboardEvent('keydown', {
    key,
    code: `Key${key.toUpperCase()}`,
    keyCode: key === 'Enter' ? 13 : key.charCodeAt(0),
    which: key === 'Enter' ? 13 : key.charCodeAt(0),
    bubbles: true,
    cancelable: true,
  });
  element.dispatchEvent(event);

  const upEvent = new KeyboardEvent('keyup', {
    key,
    code: `Key${key.toUpperCase()}`,
    keyCode: key === 'Enter' ? 13 : key.charCodeAt(0),
    which: key === 'Enter' ? 13 : key.charCodeAt(0),
    bubbles: true,
    cancelable: true,
  });
  element.dispatchEvent(upEvent);
}

async function executeDomActionInner(params: DomActionParams): Promise<DomActionResult> {
  const { action, selector, text, value, x, y, delay } = params;
  const waitMs = delay ?? 100;

  switch (action) {
    case 'click': {
      let element: HTMLElement | null = null;

      if (selector) {
        element = resolveElement(selector) as HTMLElement | null;
      } else if (text) {
        element = findElementByText(text);
      }

      if (!element) {
        return { success: false, error: `Element not found: ${selector ?? text ?? '(no selector or text)'}`, elementFound: false };
      }

      const clickable = findClickable(element);
      if (!clickable) {
        return { success: false, error: `No clickable element found for: ${selector ?? text ?? '(no selector or text)'}`, elementFound: false };
      }
      simulateClick(clickable);

      await wait(waitMs);
      return { success: true, elementFound: true, pageChanged: true };
    }

    case 'type': {
      if (!selector && !text) {
        return { success: false, error: 'type action requires a selector to identify the input element' };
      }

      let input: HTMLElement | null = null;
      if (selector) {
        input = resolveElement(selector) as HTMLElement | null;
      } else if (text) {
        input = findElementByText(text, 'label');
        if (input) {
          const forAttr = input.getAttribute('for');
          if (forAttr) {
            input = document.getElementById(forAttr) as HTMLElement | null;
          } else {
            input = input.querySelector('input, textarea') as HTMLElement | null;
          }
        }
      }

      if (!input || !('value' in input)) {
        return { success: false, error: `Input element not found: ${selector ?? '(label text)'}`, elementFound: false };
      }

      simulateInput(input as HTMLInputElement, value ?? '');

      await wait(waitMs);
      return { success: true, elementFound: true, currentValue: (input as HTMLInputElement).value };
    }

    case 'clear': {
      if (!selector) {
        return { success: false, error: 'clear action requires a selector' };
      }

      const input = resolveElement(selector) as HTMLInputElement | null;
      if (!input || !('value' in input)) {
        return { success: false, error: `Input element not found: ${selector}`, elementFound: false };
      }

      simulateInput(input, '');

      await wait(waitMs);
      return { success: true, elementFound: true };
    }

    case 'select': {
      if (!selector) {
        return { success: false, error: 'select action requires a selector' };
      }

      const select = resolveElement(selector) as HTMLSelectElement | null;
      if (!select || select.tagName !== 'SELECT') {
        return { success: false, error: `Select element not found: ${selector}`, elementFound: false };
      }

      select.value = value ?? '';
      select.dispatchEvent(new Event('change', { bubbles: true }));

      await wait(waitMs);
      return { success: true, elementFound: true, currentValue: select.value };
    }

    case 'check':
    case 'uncheck': {
      if (!selector) {
        return { success: false, error: `${action} action requires a selector` };
      }

      const checkbox = resolveElement(selector) as HTMLInputElement | null;
      if (!checkbox || checkbox.type !== 'checkbox') {
        return { success: false, error: `Checkbox not found: ${selector}`, elementFound: false };
      }

      const shouldCheck = action === 'check';
      if (checkbox.checked !== shouldCheck) {
        simulateClick(checkbox);
      }

      await wait(waitMs);
      return { success: true, elementFound: true, currentValue: String(checkbox.checked) };
    }

    case 'scroll': {
      if (selector) {
        const element = resolveElement(selector) as HTMLElement | null;
        if (element) {
          const rect = element.getBoundingClientRect();
          const headerHeight = getFixedHeaderHeight();
          const viewportHeight = window.innerHeight;

          if (rect.top < headerHeight || rect.bottom > viewportHeight || rect.bottom < 0) {
            const targetScroll = window.scrollY + rect.top - headerHeight - 20;
            window.scrollTo({
              top: Math.max(0, targetScroll),
              behavior: 'smooth',
            });
          }
        }
      } else {
        window.scrollBy({ left: x ?? 0, top: y ?? 0, behavior: 'smooth' });
      }

      await wait(waitMs + 300);
      return { success: true, elementFound: true };
    }

    case 'hover': {
      if (!selector && !text) {
        return { success: false, error: 'hover action requires a selector or text' };
      }

      let element: HTMLElement | null = null;
      if (selector) {
        element = resolveElement(selector) as HTMLElement | null;
      } else if (text) {
        element = findElementByText(text);
      }

      if (!element) {
        return { success: false, error: `Element not found: ${selector ?? text}`, elementFound: false };
      }

      const rect = element.getBoundingClientRect();
      const clientX = rect.left + rect.width / 2;
      const clientY = rect.top + rect.height / 2;
      const eventInit = {
        bubbles: true,
        cancelable: true,
        clientX,
        clientY,
        screenX: clientX,
        screenY: clientY,
      };
      element.dispatchEvent(new MouseEvent('mouseover', eventInit));
      element.dispatchEvent(new MouseEvent('mouseenter', eventInit));
      element.dispatchEvent(new MouseEvent('mousemove', eventInit));

      await wait(waitMs);
      return { success: true, elementFound: true };
    }

    case 'press_enter': {
      if (!selector) {
        const focused = document.activeElement as HTMLElement | null;
        if (focused) {
          simulateKeyDown(focused, 'Enter');
          await wait(waitMs);
          return { success: true, elementFound: true };
        }
        return { success: false, error: 'No element is focused and no selector provided' };
      }

      const element = resolveElement(selector) as HTMLElement | null;
      if (!element) {
        return { success: false, error: `Element not found: ${selector}`, elementFound: false };
      }

      simulateKeyDown(element, 'Enter');
      await wait(waitMs);
      return { success: true, elementFound: true };
    }

    default:
      return { success: false, error: `Unknown action: ${action}` };
  }
}

async function executeDomAction(params: DomActionParams): Promise<DomActionResult> {
  const result = await executeDomActionInner(params);
  return {
    ...result,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
  };
}

// ── Element Discovery ───────────────────────────────────────

interface ElementInfo {
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

function discoverInteractiveElements(): ElementInfo[] {
  const interactiveSelectors = [
    'a[href]',
    'button',
    'input',
    'select',
    'textarea',
    '[role="button"]',
    '[role="link"]',
    '[role="tab"]',
    '[onclick]',
    '[contenteditable]',
  ].join(', ');

  const seen = new Set<Element>();
  const results: ElementInfo[] = [];

  for (const el of deepQuerySelectorAll(interactiveSelectors)) {
    if (seen.has(el)) continue;
    seen.add(el);

    const htmlEl = el as HTMLElement;
    const tag = htmlEl.tagName.toLowerCase();
    const text = htmlEl.textContent?.trim().slice(0, 100) ?? '';
    const id = htmlEl.id || undefined;
    const className = htmlEl.className && typeof htmlEl.className === 'string'
      ? htmlEl.className.split(/\s+/).filter(Boolean).slice(0, 3).join(' ')
      : undefined;

    let selector: string;
    if (htmlEl.id) {
      selector = `#${CSS.escape(htmlEl.id)}`;
    } else {
      const name = htmlEl.getAttribute('name');
      if (name) {
        selector = `${tag}[name="${CSS.escape(name)}"]`;
      } else {
        const parent = htmlEl.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter(c => c.tagName === htmlEl.tagName);
          const index = siblings.indexOf(htmlEl) + 1;
          selector = `${tag}:nth-of-type(${index})`;
        } else {
          selector = tag;
        }
      }
    }

    const domRect = htmlEl.getBoundingClientRect();
    const visible = isElementVisible(htmlEl);
    const inViewport = visible && isElementInViewport(domRect);

    const info: ElementInfo = {
      tag,
      selector,
      text: text || undefined,
      boundingRect: computeBoundingRect(domRect),
      isVisible: visible,
      isInViewport: inViewport,
    };

    if (id) info.id = id;
    if (className) info.className = className;
    if (htmlEl.getAttribute('role')) info.role = htmlEl.getAttribute('role') ?? undefined;
    if (htmlEl.getAttribute('aria-label')) info.ariaLabel = htmlEl.getAttribute('aria-label') ?? undefined;

    if (tag === 'input') {
      const input = htmlEl as HTMLInputElement;
      info.type = input.type || undefined;
      info.placeholder = input.placeholder || undefined;
      info.value = input.value || undefined;
    } else if (tag === 'textarea') {
      const ta = htmlEl as HTMLTextAreaElement;
      info.placeholder = ta.placeholder || undefined;
      info.value = ta.value || undefined;
    } else if (tag === 'select') {
      const sel2 = htmlEl as HTMLSelectElement;
      info.value = sel2.value || undefined;
    } else if (tag === 'a') {
      info.href = (htmlEl as HTMLAnchorElement).href || undefined;
    }

    results.push(info);
  }

  return results;
}

// ── Text Extraction ─────────────────────────────────────────

function extractVisibleText(): string {
  const excludeTags = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'EMBED',
    'SVG', 'MATH', 'TEMPLATE', 'SLOT', 'DIALOG',
  ]);

  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node: Text): number {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (excludeTags.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
        if (parent.offsetParent === null && getComputedStyle(parent).display !== 'contents') {
          return NodeFilter.FILTER_REJECT;
        }
        const text = node.textContent?.trim();
        if (!text) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    },
  );

  const parts: string[] = [];
  let totalLength = 0;

  while (walker.nextNode()) {
    const text = walker.currentNode.textContent!.trim();
    if (totalLength + text.length > MAX_TEXT_LENGTH) {
      parts.push(text.slice(0, MAX_TEXT_LENGTH - totalLength));
      parts.push(TRUNCATION_SUFFIX);
      break;
    }
    parts.push(text);
    totalLength += text.length;
  }

  return parts.join('\n');
}

// ── Message Handling ────────────────────────────────────────

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

chrome.runtime.onMessage.addListener(
  (message: { type: string; [key: string]: unknown }, _sender, sendResponse) => {
    if (message.type === 'get_display_mode') {
      const standalone = [
        'standalone',
        'window-controls-overlay',
        'minimal-ui',
        'fullscreen',
      ].some((mode) => window.matchMedia(`(display-mode: ${mode})`).matches);
      sendResponse({ standalone });
      return true;
    }

    if (message.type === 'extract_visible_text') {
      const text = extractVisibleText();
      sendResponse({ text });
      return true;
    }

    if (message.type === 'dom_action') {
      const params = message.params as DomActionParams;
      executeDomAction(params)
        .then((result) => sendResponse(result))
        .catch((err: unknown) => {
          const errorMessage = err instanceof Error ? err.message : String(err);
          sendResponse({ success: false, error: errorMessage });
        });
      return true;
    }

    if (message.type === 'discover_elements') {
      const elements = discoverInteractiveElements();
      sendResponse({ elements });
      return true;
    }
  },
);
