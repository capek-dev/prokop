import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TOOLTIP_DELAY_MS, TOOLTIP_SKIP_DELAY_MS } from '@/components/ui/tooltip';

interface ActiveTitle {
  text: string;
  anchor: DOMRect;
}

const GAP = 6;
const EDGE = 8;

function titledElement(event: Event): HTMLElement | SVGElement | null {
  for (const node of event.composedPath()) {
    if (!(node instanceof HTMLElement || node instanceof SVGElement)) continue;
    if (node.getAttribute('title')) return node;
    if (node === document.body) break;
  }
  return null;
}

/**
 * Renders every `title` attribute through the app tooltip style and delay
 * instead of the browser's native tooltip. While hovered, the title moves to
 * `data-title` so the native one never appears; it is restored on leave.
 */
export function TitleTooltipLayer() {
  const [active, setActive] = useState<ActiveTitle | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let target: HTMLElement | SVGElement | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastHiddenAt = 0;
    let shown = false;

    const restore = () => {
      if (!target) return;
      const stashed = target.getAttribute('data-title');
      // React may have written a new title while hovered; keep the newer one.
      if (stashed !== null && !target.hasAttribute('title')) target.setAttribute('title', stashed);
      target.removeAttribute('data-title');
      target = null;
    };

    // Clicking, typing, or scrolling dismisses the bubble but keeps the title
    // stashed until the pointer leaves, so the native tooltip cannot appear.
    const dismiss = () => {
      clearTimeout(timer);
      if (shown) lastHiddenAt = performance.now();
      shown = false;
      setActive(null);
    };

    const hide = () => {
      dismiss();
      restore();
    };

    const show = () => {
      if (!target?.isConnected) { hide(); return; }
      const text = target.getAttribute('data-title') ?? '';
      if (!text) return;
      shown = true;
      setActive({ text, anchor: target.getBoundingClientRect() });
    };

    const onOver = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      const next = titledElement(event);
      if (!next || next === target) return;
      const warm = shown || performance.now() - lastHiddenAt < TOOLTIP_SKIP_DELAY_MS;
      hide();
      target = next;
      target.setAttribute('data-title', target.getAttribute('title') ?? '');
      target.removeAttribute('title');
      timer = setTimeout(show, warm ? 0 : TOOLTIP_DELAY_MS);
    };

    const onOut = (event: PointerEvent) => {
      if (!target) return;
      const to = event.relatedTarget;
      if (to instanceof Node && target.contains(to)) return;
      hide();
    };

    document.addEventListener('pointerover', onOver, true);
    document.addEventListener('pointerout', onOut, true);
    document.addEventListener('pointerdown', dismiss, true);
    document.addEventListener('keydown', dismiss, true);
    document.addEventListener('wheel', dismiss, { capture: true, passive: true });
    window.addEventListener('blur', hide);
    return () => {
      hide();
      document.removeEventListener('pointerover', onOver, true);
      document.removeEventListener('pointerout', onOut, true);
      document.removeEventListener('pointerdown', dismiss, true);
      document.removeEventListener('keydown', dismiss, true);
      document.removeEventListener('wheel', dismiss, true);
      window.removeEventListener('blur', hide);
    };
  }, []);

  // Measure, then place below the anchor (above when there is no room).
  useLayoutEffect(() => {
    const bubble = bubbleRef.current;
    if (!active || !bubble) return;
    const { width, height } = bubble.getBoundingClientRect();
    const { anchor } = active;
    const below = anchor.bottom + GAP;
    const top = below + height > window.innerHeight - EDGE ? anchor.top - GAP - height : below;
    const centered = anchor.left + anchor.width / 2 - width / 2;
    const left = Math.min(Math.max(EDGE, centered), window.innerWidth - EDGE - width);
    bubble.style.left = `${left}px`;
    bubble.style.top = `${top}px`;
    bubble.style.visibility = 'visible';
  }, [active]);

  if (!active) return null;

  return createPortal(
    <div
      ref={bubbleRef}
      role="tooltip"
      className="pointer-events-none fixed z-[100] w-max max-w-xs rounded-md bg-foreground px-3 py-1.5 text-xs whitespace-pre-line text-background animate-in fade-in-0 duration-100"
      style={{ left: 0, top: 0, visibility: 'hidden' }}
    >
      {active.text}
    </div>,
    document.body,
  );
}
