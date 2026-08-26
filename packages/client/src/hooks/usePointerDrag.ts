import { useCallback, useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

interface PointerDragOptions<T> {
  cursor: string;
  onMove: (event: PointerEvent) => T | null;
  onCommit: (value: T) => void;
}

/**
 * Coalesces pointer movement to one DOM update per animation frame and commits
 * reactive state only when the gesture ends.
 */
export function usePointerDrag<T>({
  cursor,
  onMove,
  onCommit,
}: PointerDragOptions<T>): (event: ReactPointerEvent<HTMLElement>) => void {
  const onMoveRef = useRef(onMove);
  const onCommitRef = useRef(onCommit);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    onMoveRef.current = onMove;
    onCommitRef.current = onCommit;
  }, [onMove, onCommit]);

  useEffect(() => () => cleanupRef.current?.(), []);

  return useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;

    cleanupRef.current?.();
    event.preventDefault();

    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    let animationFrame: number | null = null;
    let pendingEvent: PointerEvent | null = null;
    let latestValue: T | null = null;
    let finished = false;

    document.body.style.cursor = cursor;
    document.body.style.userSelect = 'none';

    try {
      handle.setPointerCapture(pointerId);
    } catch {
      // Document listeners keep the drag working where pointer capture is unavailable.
    }

    const applyPendingMove = () => {
      animationFrame = null;
      if (!pendingEvent) return;
      const nextEvent = pendingEvent;
      pendingEvent = null;
      const nextValue = onMoveRef.current(nextEvent);
      if (nextValue !== null) latestValue = nextValue;
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      pendingEvent = moveEvent;
      if (animationFrame === null) {
        animationFrame = requestAnimationFrame(applyPendingMove);
      }
    };

    const cleanup = () => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerEnd);
      document.removeEventListener('pointercancel', handlePointerEnd);
      window.removeEventListener('blur', handleWindowBlur);
      if (animationFrame !== null) {
        cancelAnimationFrame(animationFrame);
        animationFrame = null;
      }
      pendingEvent = null;
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      try {
        if (handle.hasPointerCapture(pointerId)) {
          handle.releasePointerCapture(pointerId);
        }
      } catch {
        // Pointer capture may already have been released by the browser.
      }
      if (cleanupRef.current === cleanup) cleanupRef.current = null;
    };

    function handleWindowBlur() {
      if (finished) return;
      finished = true;
      cleanup();
    }

    const handlePointerEnd = (endEvent: PointerEvent) => {
      if (finished || endEvent.pointerId !== pointerId) return;
      finished = true;
      if (pendingEvent) {
        if (animationFrame !== null) {
          cancelAnimationFrame(animationFrame);
          animationFrame = null;
        }
        applyPendingMove();
      }
      cleanup();
      if (latestValue !== null) onCommitRef.current(latestValue);
    };

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerEnd);
    document.addEventListener('pointercancel', handlePointerEnd);
    window.addEventListener('blur', handleWindowBlur);
    cleanupRef.current = cleanup;
  }, [cursor]);
}
