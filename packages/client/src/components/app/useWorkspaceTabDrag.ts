import { useEffect, useRef, useState } from 'react';
import type { DragEvent, RefObject } from 'react';
import type { WorkspaceViewId } from '@/stores/workspaceViewStore';

const TAB_DRAG_TYPE = 'application/x-prokop-workspace-tab';
// Only accept a tab drag started in this document, never an external payload.
let activeDrag: { id: WorkspaceViewId; source: HTMLElement } | null = null;

interface Insertion {
  beforeId: WorkspaceViewId | null;
  left: number;
}

function insertionAt(scroller: HTMLDivElement, clientX: number): Insertion {
  const bounds = scroller.getBoundingClientRect();
  const tabs = Array.from(scroller.querySelectorAll<HTMLElement>('[data-workspace-tab-id]'));
  for (const tab of tabs) {
    const rect = tab.getBoundingClientRect();
    if (clientX < rect.left + rect.width / 2) {
      return { beforeId: tab.dataset.workspaceTabId as WorkspaceViewId, left: rect.left - bounds.left + scroller.scrollLeft };
    }
  }
  const last = tabs.at(-1)?.getBoundingClientRect();
  return { beforeId: null, left: last ? last.right - bounds.left + scroller.scrollLeft : scroller.scrollLeft + 2 };
}

export function useWorkspaceTabDrag(
  scrollerRef: RefObject<HTMLDivElement | null>,
  onMove?: (id: WorkspaceViewId, beforeId: WorkspaceViewId | null) => void,
) {
  const [insertion, setInsertion] = useState<Insertion | null>(null);
  const frame = useRef<number | null>(null);
  const pointerX = useRef(0);

  const reset = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    setInsertion(null);
  };

  useEffect(() => {
    const scroller = scrollerRef.current;
    const end = () => {
      activeDrag = null;
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      setInsertion(null);
    };
    window.addEventListener('dragend', end);
    window.addEventListener('drop', end);
    window.addEventListener('blur', end);
    return () => {
      window.removeEventListener('dragend', end);
      window.removeEventListener('drop', end);
      window.removeEventListener('blur', end);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      if (activeDrag && scroller?.contains(activeDrag.source)) activeDrag = null;
    };
  }, [scrollerRef]);

  const accepts = (event: DragEvent) => !!onMove && !!activeDrag?.source.isConnected
    && !activeDrag.source.closest('[inert], [aria-hidden="true"]')
    && !event.currentTarget.closest('[inert], [aria-hidden="true"]')
    && event.dataTransfer.types.includes(TAB_DRAG_TYPE);

  const updateInsertion = (scroller: HTMLDivElement) => {
    const next = insertionAt(scroller, pointerX.current);
    setInsertion((previous) => previous?.beforeId === next.beforeId && previous.left === next.left ? previous : next);
  };

  const scrollAtEdge = () => {
    const scroller = scrollerRef.current;
    if (!scroller || !activeDrag?.source.isConnected) { reset(); return; }
    const bounds = scroller.getBoundingClientRect();
    const edge = Math.min(36, bounds.width / 3);
    const x = pointerX.current;
    const speed = x < bounds.left + edge ? -8 * Math.min(1, (bounds.left + edge - x) / edge)
      : x > bounds.right - edge ? 8 * Math.min(1, (x - bounds.right + edge) / edge) : 0;
    scroller.scrollLeft += speed;
    updateInsertion(scroller);
    frame.current = requestAnimationFrame(scrollAtEdge);
  };

  return {
    insertion,
    start: (id: WorkspaceViewId, event: DragEvent<HTMLButtonElement>) => {
      if (!onMove) { event.preventDefault(); return; }
      activeDrag = { id, source: event.currentTarget };
      event.dataTransfer.setData(TAB_DRAG_TYPE, id);
      event.dataTransfer.effectAllowed = 'move';
      event.stopPropagation();
    },
    stripEvents: {
      onDragOver: (event: DragEvent<HTMLDivElement>) => {
        if (!accepts(event)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
        pointerX.current = event.clientX;
        updateInsertion(event.currentTarget);
        if (frame.current === null) frame.current = requestAnimationFrame(scrollAtEdge);
      },
      onDragLeave: (event: DragEvent<HTMLDivElement>) => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) reset();
      },
      onDrop: (event: DragEvent<HTMLDivElement>) => {
        if (!accepts(event) || !activeDrag) return;
        event.preventDefault();
        const id = activeDrag.id;
        const target = insertionAt(event.currentTarget, event.clientX);
        activeDrag = null;
        reset();
        onMove?.(id, target.beforeId);
      },
    },
  };
}
