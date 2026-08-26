import { act, fireEvent, render } from '@testing-library/react';
import { useRef } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { usePointerDrag } from '@/hooks/usePointerDrag';

function Harness({
  onMove,
  onCommit,
}: {
  onMove: (event: PointerEvent) => number | null;
  onCommit: (value: number) => void;
}) {
  const targetRef = useRef<HTMLDivElement | null>(null);
  const startDrag = usePointerDrag({
    cursor: 'ew-resize',
    onMove: (event) => {
      const value = onMove(event);
      if (value !== null && targetRef.current) {
        targetRef.current.style.width = `${value}px`;
      }
      return value;
    },
    onCommit,
  });

  return <div ref={targetRef} data-testid="target" onPointerDown={startDrag} />;
}

describe('usePointerDrag', () => {
  let animationFrameCallback: FrameRequestCallback | null;

  beforeEach(() => {
    animationFrameCallback = null;
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      animationFrameCallback = callback;
      return 1;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });

  test('coalesces movement and commits the latest value once on release', () => {
    const onMove = vi.fn((event: PointerEvent) => event.clientX);
    const onCommit = vi.fn();
    const { getByTestId } = render(<Harness onMove={onMove} onCommit={onCommit} />);
    const target = getByTestId('target');

    fireEvent.pointerDown(target, { button: 0, pointerId: 7, clientX: 10 });
    fireEvent.pointerMove(document, { pointerId: 7, clientX: 40 });
    fireEvent.pointerMove(document, { pointerId: 7, clientX: 60 });

    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(onMove).not.toHaveBeenCalled();
    expect(document.body.style.cursor).toBe('ew-resize');

    act(() => animationFrameCallback?.(0));

    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove.mock.calls[0]?.[0].clientX).toBe(60);
    expect(target).toHaveStyle({ width: '60px' });

    fireEvent.pointerUp(document, { pointerId: 7, clientX: 60 });
    fireEvent.pointerUp(document, { pointerId: 7, clientX: 60 });

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(60);
    expect(document.body.style.cursor).toBe('');
    expect(document.body.style.userSelect).toBe('');
  });

  test('flushes a pending move before pointer cancellation commits', () => {
    const onMove = vi.fn((event: PointerEvent) => event.clientX);
    const onCommit = vi.fn();
    const { getByTestId } = render(<Harness onMove={onMove} onCommit={onCommit} />);

    fireEvent.pointerDown(getByTestId('target'), { button: 0, pointerId: 3, clientX: 10 });
    fireEvent.pointerMove(document, { pointerId: 3, clientX: 75 });
    fireEvent.pointerCancel(document, { pointerId: 3, clientX: 75 });

    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(75);
  });

  test('cleans up without committing when the window loses focus', () => {
    const onMove = vi.fn((event: PointerEvent) => event.clientX);
    const onCommit = vi.fn();
    const { getByTestId } = render(<Harness onMove={onMove} onCommit={onCommit} />);

    fireEvent.pointerDown(getByTestId('target'), { button: 0, pointerId: 5, clientX: 10 });
    fireEvent.pointerMove(document, { pointerId: 5, clientX: 50 });
    fireEvent.blur(window);
    fireEvent.pointerUp(document, { pointerId: 5, clientX: 50 });

    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
    expect(onCommit).not.toHaveBeenCalled();
    expect(document.body.style.cursor).toBe('');
  });

  test('removes drag side effects when unmounted mid-gesture', () => {
    const onMove = vi.fn((event: PointerEvent) => event.clientX);
    const onCommit = vi.fn();
    const { getByTestId, unmount } = render(<Harness onMove={onMove} onCommit={onCommit} />);

    fireEvent.pointerDown(getByTestId('target'), { button: 0, pointerId: 9, clientX: 10 });
    fireEvent.pointerMove(document, { pointerId: 9, clientX: 90 });
    unmount();
    fireEvent.pointerUp(document, { pointerId: 9, clientX: 90 });

    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
    expect(onMove).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
    expect(document.body.style.cursor).toBe('');
  });
});
