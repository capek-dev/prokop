import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { SessionHarnessUsageState } from '@prokopai/sdk';
import { TokenMeter } from '@/components/chat/TokenMeter';

function usage(overrides: Partial<SessionHarnessUsageState> = {}): SessionHarnessUsageState {
  return {
    used: 50000,
    contextWindow: 200000,
    rows: [
      { label: 'Latest input', value: '1,200' },
      { label: 'Latest output', value: '100' },
      { label: 'Context', value: '50,000 / 200,000' },
    ],
    ...overrides,
  };
}

describe('TokenMeter (server-normalized usage)', () => {
  it('renders the unknown state without usage', () => {
    render(<TokenMeter usage={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Token usage' })).toBeDisabled();
  });

  it('defaults to unknown when the prop is omitted', () => {
    render(<TokenMeter />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('shows the raw total when no context window is reported', () => {
    render(<TokenMeter usage={usage({ used: 1500, contextWindow: 0, rows: [] })} />);
    const button = screen.getByRole('button', { name: 'Token usage' });
    expect(button).toBeEnabled();
    expect(screen.getByText('1,500')).toBeInTheDocument();
  });

  it('shows the context percentage when a window is reported', () => {
    render(<TokenMeter usage={usage()} />);
    expect(screen.getByText('25%')).toBeInTheDocument();
  });

  it('opens the detail popover with the server-provided rows', async () => {
    render(<TokenMeter usage={usage()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Token usage' }));
    expect(screen.getByText('Context used')).toBeInTheDocument();
    expect(screen.getAllByText('50,000 / 200,000').length).toBeGreaterThan(0);
    expect(screen.getByText('Latest input')).toBeInTheDocument();
    expect(screen.getByText('1,200')).toBeInTheDocument();
  });

  it('clamps the percentage at 100', () => {
    render(<TokenMeter usage={usage({ used: 300000, contextWindow: 200000 })} />);
    expect(screen.getByText('100%')).toBeInTheDocument();
  });
});
