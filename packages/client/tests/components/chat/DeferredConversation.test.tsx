import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { DeferredConversation } from '@/components/chat/DeferredConversation';

let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;

function paintFrame() {
  act(() => {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach(callback => callback(0));
  });
}

beforeEach(() => {
  frames = new Map();
  nextFrame = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('DeferredConversation', () => {
  test('does not render cached conversation children before a paint opportunity', () => {
    const expensiveRender = vi.fn();
    function Conversation() {
      expensiveRender();
      return <div>Cached transcript</div>;
    }
    render(<DeferredConversation><Conversation /></DeferredConversation>);
    expect(screen.getByText('Loading conversation...')).toBeInTheDocument();
    expect(expensiveRender).not.toHaveBeenCalled();
    paintFrame();
    expect(expensiveRender).not.toHaveBeenCalled();
    paintFrame();
    expect(screen.getByText('Cached transcript')).toBeInTheDocument();
  });

  test('resets on session switch and uses latest children without restarting the delay', () => {
    const view = render(<DeferredConversation key="a">Session A</DeferredConversation>);
    paintFrame();
    paintFrame();
    view.rerender(<DeferredConversation key="b">Session B</DeferredConversation>);
    expect(screen.queryByText('Session A')).not.toBeInTheDocument();
    expect(screen.getByText('Loading conversation...')).toBeInTheDocument();
    paintFrame();
    view.rerender(<DeferredConversation key="b">Updated B</DeferredConversation>);
    paintFrame();
    expect(screen.getByText('Updated B')).toBeInTheDocument();
  });

  test.each([0, 1])('cancels scheduled mounting after %i frames on unmount', (count) => {
    const view = render(<DeferredConversation>Transcript</DeferredConversation>);
    if (count) paintFrame();
    view.unmount();
    expect(frames.size).toBe(0);
  });
});
