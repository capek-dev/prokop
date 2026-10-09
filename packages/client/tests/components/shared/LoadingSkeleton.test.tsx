import { act, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import {
  SessionListSkeleton,
  MessageSkeleton,
  ChatLoadingState,
  CHAT_PLACEHOLDER_DELAY_MS,
  WorkspaceSkeleton,
  ConnectingState,
} from '@/components/shared/LoadingSkeleton';

describe('SessionListSkeleton', () => {
  it('renders without crashing', () => {
    const { container } = render(<SessionListSkeleton />);
    expect(container.firstChild).toBeInTheDocument();
  });

  it('renders skeleton placeholders', () => {
    const { container } = render(<SessionListSkeleton />);
    const skeletons = container.querySelectorAll('[data-slot="skeleton"]');
    expect(skeletons.length).toBeGreaterThan(0);
  });
});

describe('MessageSkeleton', () => {
  it('renders without crashing', () => {
    const { container } = render(<MessageSkeleton />);
    expect(container.firstChild).toBeInTheDocument();
  });

  it('renders skeleton elements', () => {
    const { container } = render(<MessageSkeleton />);
    const skeletons = container.querySelectorAll('[data-slot="skeleton"]');
    expect(skeletons.length).toBeGreaterThan(0);
  });
});

describe('ChatLoadingState', () => {
  it('renders loading text', () => {
    render(<ChatLoadingState />);
    expect(screen.getByText('Loading conversation...')).toBeInTheDocument();
  });

  it('draws nothing for fast loads, then a static placeholder without a spinner', () => {
    vi.useFakeTimers();
    try {
      const { container } = render(<ChatLoadingState />);
      expect(container.querySelector('[data-slot="chat-placeholder"]')).not.toBeInTheDocument();
      act(() => { vi.advanceTimersByTime(CHAT_PLACEHOLDER_DELAY_MS); });
      expect(container.querySelector('[data-slot="chat-placeholder"]')).toBeInTheDocument();
      expect(container.querySelector('.animate-spin')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('WorkspaceSkeleton', () => {
  it('renders without crashing', () => {
    const { container } = render(<WorkspaceSkeleton />);
    expect(container.firstChild).toBeInTheDocument();
  });

  it('renders skeleton element', () => {
    const { container } = render(<WorkspaceSkeleton />);
    const skeleton = container.querySelector('[data-slot="skeleton"]');
    expect(skeleton).toBeInTheDocument();
  });
});

describe('ConnectingState', () => {
  it('renders default message', () => {
    render(<ConnectingState />);
    expect(screen.getByText('Connecting to server...')).toBeInTheDocument();
  });

  it('renders custom message', () => {
    render(<ConnectingState message="Reconnecting..." />);
    expect(screen.getByText('Reconnecting...')).toBeInTheDocument();
  });

  it('renders spinner icon', () => {
    const { container } = render(<ConnectingState />);
    const spinner = container.querySelector('.animate-spin');
    expect(spinner).toBeInTheDocument();
  });
});
