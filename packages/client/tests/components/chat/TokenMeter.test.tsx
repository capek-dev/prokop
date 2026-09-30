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
  it('renders SVG ring indicator', () => {
    const { container } = render(<TokenMeter />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg?.getAttribute('viewBox')).toBe('0 0 20 20');
  });

  it('shows the context percentage with the usage aria label', () => {
    render(<TokenMeter usage={usage()} />);
    expect(screen.getByText('25%')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Token usage: 25% of context window' })).toBeInTheDocument();
  });

  it('click reveals compact counts and toggles back', async () => {
    render(<TokenMeter usage={usage()} />);
    const button = screen.getByRole('button', { name: 'Token usage: 25% of context window' });
    await userEvent.click(button);
    expect(screen.getByText('50.0k/200.0k')).toBeInTheDocument();
    await userEvent.click(button);
    expect(screen.getByText('25%')).toBeInTheDocument();
  });

  it('uses normal ring color for low usage', () => {
    const { container } = render(
      <TokenMeter usage={usage({ used: 1000, contextWindow: 10000, rows: [] })} />,
    );
    const progressRing = container.querySelectorAll('circle')[1];
    expect(progressRing?.className.baseVal ?? progressRing?.getAttribute('class') ?? '').toContain('text-primary');
  });

  it('uses warning ring color for 40%+ usage', () => {
    const { container } = render(
      <TokenMeter usage={usage({ used: 5000, contextWindow: 10000, rows: [] })} />,
    );
    const progressRing = container.querySelectorAll('circle')[1];
    const cls = progressRing?.className.baseVal ?? progressRing?.getAttribute('class') ?? '';
    expect(cls).toContain('text-warning');
  });

  it('uses critical ring color for 60%+ usage', () => {
    const { container } = render(
      <TokenMeter usage={usage({ used: 7000, contextWindow: 10000, rows: [] })} />,
    );
    const progressRing = container.querySelectorAll('circle')[1];
    const cls = progressRing?.className.baseVal ?? progressRing?.getAttribute('class') ?? '';
    expect(cls).toContain('text-destructive');
  });

  it('clamps the percentage at 100', () => {
    render(<TokenMeter usage={usage({ used: 300000 })} />);
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('formats large numbers compactly', async () => {
    render(<TokenMeter usage={usage({ used: 1500000, contextWindow: 2000000, rows: [] })} />);
    await userEvent.click(screen.getByText('75%'));
    expect(screen.getByText('1.5M/2.0M')).toBeInTheDocument();
  });

  it('shows 0/0 when no usage and clicked', async () => {
    render(<TokenMeter />);
    expect(screen.getByText('0%')).toBeInTheDocument();
    await userEvent.click(screen.getByText('0%'));
    expect(screen.getByText('0/0')).toBeInTheDocument();
  });
});
