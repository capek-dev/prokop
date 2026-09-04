import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { EmptySessionCheckout } from '@/components/chat/EmptySessionCheckout';

describe('EmptySessionCheckout', () => {
  test('renders the plain empty state without any worktree UI', () => {
    render(<EmptySessionCheckout />);

    expect(screen.getByText('Start a conversation')).toBeInTheDocument();
    expect(screen.getByText('Send a message below to begin.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
