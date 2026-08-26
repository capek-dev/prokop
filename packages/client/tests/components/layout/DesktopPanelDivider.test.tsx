import { fireEvent, render } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { DesktopPanelDivider } from '@/components/layout/DesktopPanelDivider';

describe('DesktopPanelDivider', () => {
  test('provides one shared desktop panel resize contract', () => {
    const onKeyDown = vi.fn();
    const onPointerDown = vi.fn();
    const { container, getByRole } = render(
      <DesktopPanelDivider
        label="Resize panel"
        min={220}
        max={720}
        value={320.4}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
      />,
    );

    const divider = getByRole('separator', { name: 'Resize panel' });
    expect(divider).toHaveAttribute('aria-valuemin', '220');
    expect(divider).toHaveAttribute('aria-valuemax', '720');
    expect(divider).toHaveAttribute('aria-valuenow', '320');
    expect(divider).toHaveClass('relative', 'w-px', 'shrink-0', 'touch-none', 'bg-border');
    expect(divider).toHaveClass(
      'after:absolute',
      'after:inset-y-0',
      'after:w-3',
      "after:content-['']",
    );
    expect(
      container.querySelector('[data-slot="desktop-panel-divider-indicator"]'),
    ).toHaveClass('left-1/2', '-translate-x-1/2', 'rounded-full');

    fireEvent.keyDown(divider, { key: 'ArrowLeft' });
    fireEvent.pointerDown(divider, { button: 0, pointerId: 1 });

    expect(onKeyDown).toHaveBeenCalledOnce();
    expect(onPointerDown).toHaveBeenCalledOnce();
  });
});
