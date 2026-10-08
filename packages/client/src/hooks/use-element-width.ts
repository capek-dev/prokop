import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Tracks an element's content width with a ResizeObserver. Returns a callback
 * ref and the latest width (null until the element mounts). Updates are
 * batched to one per animation frame.
 */
export function useElementWidth<T extends HTMLElement>() {
  const [width, setWidth] = useState<number | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const frameRef = useRef<number | null>(null);

  const cleanup = () => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  };

  const ref = useCallback((node: T | null) => {
    cleanup();
    if (!node) return;
    setWidth(node.getBoundingClientRect().width);
    observerRef.current = new ResizeObserver((entries) => {
      const entry = entries.at(-1);
      if (!entry) return;
      const next = entry.contentRect.width;
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        setWidth(next);
      });
    });
    observerRef.current.observe(node);
  }, []);

  useEffect(() => cleanup, []);

  return [ref, width] as const;
}
