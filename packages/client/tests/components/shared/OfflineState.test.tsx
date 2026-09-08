import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { OfflineState } from '@/components/shared/OfflineState';

describe('OfflineState', () => {
  const defaultProps = {
    serverUrl: 'http://localhost:3000',
    retryCount: 3,
    nextRetryIn: 10,
    onRetry: vi.fn(),
    onLogout: vi.fn(),
  };

  it('renders reconnecting heading', () => {
    render(<OfflineState {...defaultProps} />);
    expect(
      screen.getByText('Reconnecting to server'),
    ).toBeInTheDocument();
  });

  it('shows default message when no authError', () => {
    render(<OfflineState {...defaultProps} />);
    expect(
      screen.getByText('Please check that the server is running.'),
    ).toBeInTheDocument();
  });

  it('shows authError when provided', () => {
    render(
      <OfflineState {...defaultProps} authError="Invalid token" />,
    );
    expect(screen.getByText('Invalid token')).toBeInTheDocument();
    expect(
      screen.queryByText('Please check that the server is running.'),
    ).not.toBeInTheDocument();
  });

  it('displays server URL', () => {
    render(<OfflineState {...defaultProps} />);
    expect(screen.getByText('http://localhost:3000')).toBeInTheDocument();
  });

  it('hides server URL when null', () => {
    render(
      <OfflineState {...defaultProps} serverUrl={null} />,
    );
    expect(
      screen.queryByText('http://localhost:3000'),
    ).not.toBeInTheDocument();
  });

  it('shows an active attempt without a zero-second countdown', () => {
    render(<OfflineState {...defaultProps} nextRetryIn={0} />);
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting...');
    expect(screen.queryByText('Retrying in 0s...')).not.toBeInTheDocument();
  });

  it('does not promise automatic retries after an auth failure', () => {
    render(<OfflineState {...defaultProps} authError="Invalid token" />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText('Authentication required')).toBeInTheDocument();
  });

  it('displays retry countdown', () => {
    render(<OfflineState {...defaultProps} />);
    expect(screen.getByText('Retrying in 10s...')).toBeInTheDocument();
  });

  it('calls onRetry when Retry Now clicked', async () => {
    const onRetry = vi.fn();
    render(<OfflineState {...defaultProps} onRetry={onRetry} />);
    await userEvent.click(
      screen.getByRole('button', { name: /retry now/i }),
    );
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('calls onLogout when Change Server clicked', async () => {
    const onLogout = vi.fn();
    render(<OfflineState {...defaultProps} onLogout={onLogout} />);
    await userEvent.click(
      screen.getByRole('button', { name: /change server/i }),
    );
    expect(onLogout).toHaveBeenCalledOnce();
  });

  it('shows retry count when greater than 0', () => {
    render(<OfflineState {...defaultProps} retryCount={5} />);
    expect(screen.getByText('Retry attempt: 5')).toBeInTheDocument();
  });

  it('hides retry count when 0', () => {
    render(<OfflineState {...defaultProps} retryCount={0} />);
    expect(screen.queryByText(/retry attempt/i)).not.toBeInTheDocument();
  });
});
