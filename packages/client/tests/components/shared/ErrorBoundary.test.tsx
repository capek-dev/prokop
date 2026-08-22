import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ErrorBoundary } from '@/components/shared/ErrorBoundary';

function renderBoundary(error: Error): void {
  const boundary = new ErrorBoundary({ children: null });
  boundary.state = {
    hasError: true,
    error,
    isRecovering: false,
  };
  render(boundary.render());
}

describe('ErrorBoundary recovery', () => {
  it('offers PWA recovery for stale chunk failures', () => {
    renderBoundary(new Error('Failed to fetch dynamically imported module'));

    expect(screen.getByRole('button', { name: 'Reload Prokopai' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset downloaded app files' })).toBeInTheDocument();
  });

  it('retains the generic recovery action for other render failures', () => {
    renderBoundary(new Error('Normal render failure'));

    expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reload Prokopai' })).not.toBeInTheDocument();
  });
});
