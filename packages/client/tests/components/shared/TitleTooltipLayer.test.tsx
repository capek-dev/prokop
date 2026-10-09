import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TitleTooltipLayer } from '@/components/shared/TitleTooltipLayer';
import { TOOLTIP_DELAY_MS } from '@/components/ui/tooltip';

function hover(target: Element) {
  target.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, composed: true, pointerType: 'mouse' }));
}

function leave(target: Element) {
  target.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, composed: true, pointerType: 'mouse', relatedTarget: document.body }));
}

describe('TitleTooltipLayer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the title in the app tooltip after the shared delay, without a native title', () => {
    render(<><TitleTooltipLayer /><button title="Refresh server status">R</button></>);
    const button = screen.getByRole('button');

    act(() => hover(button));
    expect(button).not.toHaveAttribute('title');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(TOOLTIP_DELAY_MS); });
    expect(screen.getByRole('tooltip')).toHaveTextContent('Refresh server status');
  });

  it('restores the title when the pointer leaves', () => {
    render(<><TitleTooltipLayer /><button title="Fetch origin">F</button></>);
    const button = screen.getByRole('button');

    act(() => hover(button));
    act(() => { vi.advanceTimersByTime(TOOLTIP_DELAY_MS); });
    act(() => leave(button));

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(button).toHaveAttribute('title', 'Fetch origin');
    expect(button).not.toHaveAttribute('data-title');
  });

  it('dismisses on click but keeps the native title suppressed until leave', () => {
    render(<><TitleTooltipLayer /><button title="Close tab">x</button></>);
    const button = screen.getByRole('button');

    act(() => hover(button));
    act(() => { vi.advanceTimersByTime(TOOLTIP_DELAY_MS); });
    act(() => { button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(button).not.toHaveAttribute('title');
  });

  it('ignores touch input', () => {
    render(<><TitleTooltipLayer /><button title="Pin">P</button></>);
    const button = screen.getByRole('button');

    act(() => { button.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'touch' })); });
    act(() => { vi.advanceTimersByTime(TOOLTIP_DELAY_MS); });

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(button).toHaveAttribute('title', 'Pin');
  });
});
