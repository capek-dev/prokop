import type { KeyboardEventHandler, PointerEventHandler } from 'react';

interface DesktopPanelDividerProps {
  label: string;
  min: number;
  max: number;
  value: number;
  onKeyDown: KeyboardEventHandler<HTMLDivElement>;
  onPointerDown: PointerEventHandler<HTMLDivElement>;
}

/** Shared resize affordance for inline desktop workspace panels. */
export function DesktopPanelDivider({
  label,
  min,
  max,
  value,
  onKeyDown,
  onPointerDown,
}: DesktopPanelDividerProps) {
  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      data-slot="desktop-panel-divider"
      className="group/divider relative z-10 w-3 shrink-0 touch-none cursor-ew-resize bg-transparent after:absolute after:inset-y-0 after:left-1/2 after:w-3 after:-translate-x-1/2 after:content-['']"
    >
      <div
        data-slot="desktop-panel-divider-indicator"
        className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 rounded-full bg-transparent transition-colors group-hover/divider:bg-primary"
      />
    </div>
  );
}
