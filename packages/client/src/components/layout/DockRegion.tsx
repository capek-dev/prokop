import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { DesktopPanelDivider } from '@/components/layout/DesktopPanelDivider';
import { usePointerDrag } from '@/hooks/usePointerDrag';
import { cn } from '@/lib/utils';
import { DOCK_SIZE_LIMITS, useDockStore } from '@/stores/dockStore';
import type { DockPosition } from '@/stores/dockStore';

interface DockRegionProps {
  position: DockPosition;
  children: ReactNode;
  /** Content supplies its own mobile overlay; keep the same React ancestry. */
  overlay?: boolean;
}

/** Placement owns geometry and visibility; content keeps its own lifetime. */
export function DockRegion({ position, children, overlay = false }: DockRegionProps) {
  const dock = useDockStore((state) => state.docks[position]);
  const setDockSize = useDockStore((state) => state.setDockSize);
  const regionRef = useRef<HTMLElement>(null);
  const limits = DOCK_SIZE_LIMITS[position];
  const [availableSize, setAvailableSize] = useState<number>(limits.max);
  const maximum = Math.max(limits.min, Math.min(limits.max, availableSize));
  const size = Math.min(dock.size, maximum);
  const horizontal = position === 'bottom';

  useEffect(() => {
    if (overlay) return;
    const container = regionRef.current?.parentElement;
    if (!container) return;
    let frame: number | null = null;
    const measure = () => {
      const rect = container.getBoundingClientRect();
      const extent = horizontal ? rect.height : rect.width;
      if (extent <= 0) return;
      // Keep space for the center. A temporary viewport constraint does not
      // overwrite the preferred size saved by the user's resize action.
      setAvailableSize(horizontal ? extent * 0.7 : extent - 392);
    };
    measure();
    const observer = new ResizeObserver(() => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { frame = null; measure(); });
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [horizontal, overlay]);

  const clamp = useCallback((value: number) => (
    Math.max(limits.min, Math.min(maximum, value))
  ), [limits.min, maximum]);

  const resize = useCallback((event: PointerEvent): number | null => {
    const region = regionRef.current;
    if (!region) return null;
    const rect = region.getBoundingClientRect();
    const next = clamp(position === 'left'
      ? event.clientX - rect.left
      : position === 'right' ? rect.right - event.clientX : rect.bottom - event.clientY);
    region.style.setProperty('--dock-size', `${next}px`);
    return next;
  }, [clamp, position]);

  const commitSize = useCallback((value: number) => {
    setDockSize(position, value);
  }, [position, setDockSize]);

  const onPointerDown = usePointerDrag({
    cursor: horizontal ? 'ns-resize' : 'ew-resize',
    onMove: resize,
    onCommit: commitSize,
  });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const grow = position === 'left' ? 'ArrowRight' : horizontal ? 'ArrowUp' : 'ArrowLeft';
    const shrink = position === 'left' ? 'ArrowLeft' : horizontal ? 'ArrowDown' : 'ArrowRight';
    if (event.key !== grow && event.key !== shrink) return;
    event.preventDefault();
    const next = clamp(size + (event.key === grow ? 16 : -16));
    regionRef.current?.style.setProperty('--dock-size', `${next}px`);
    commitSize(next);
  };

  const divider = dock.open && !overlay && (
    <DesktopPanelDivider
      label={`Resize ${position} dock`}
      orientation={horizontal ? 'horizontal' : 'vertical'}
      min={limits.min}
      max={maximum}
      value={size}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
    />
  );

  return (
    <>
      {position !== 'left' && divider}
      <section
        ref={regionRef}
        aria-label={`${position[0].toUpperCase()}${position.slice(1)} dock`}
        aria-hidden={!dock.open}
        inert={!dock.open}
        data-dock-position={position}
        data-state={dock.open ? 'expanded' : 'collapsed'}
        className={overlay ? 'contents' : cn(
          'flex min-h-0 min-w-0 shrink-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground',
          dock.open ? 'rounded-xl border border-border/50' : 'invisible pointer-events-none',
        )}
        style={overlay ? undefined : {
          '--dock-size': `${size}px`,
          [horizontal ? 'height' : 'width']: dock.open ? 'var(--dock-size)' : 0,
        } as CSSProperties}
      >
        {children}
      </section>
      {position === 'left' && divider}
    </>
  );
}
