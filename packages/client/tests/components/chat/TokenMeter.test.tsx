import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { TokenMeter } from '@/components/chat/TokenMeter';

describe('TokenMeter', () => {
  it('renders with zero tokens by default', () => {
    render(<TokenMeter />);
    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('renders percentage of token usage', () => {
    render(<TokenMeter totalTokens={5000} contextWindow={20000} />);
    expect(screen.getByText('25%')).toBeInTheDocument();
  });

  it('renders 0% when totalTokens is 0 even with contextWindow', () => {
    render(<TokenMeter totalTokens={0} contextWindow={20000} />);
    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('renders 0% when contextWindow is 0', () => {
    render(<TokenMeter totalTokens={5000} contextWindow={0} />);
    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('caps percentage at 100%', () => {
    render(<TokenMeter totalTokens={50000} contextWindow={10000} />);
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('shows exact token counts when clicked', async () => {
    render(<TokenMeter totalTokens={1500} contextWindow={10000} />);
    await userEvent.click(screen.getByText('15%'));
    expect(screen.getByText('1.5k/10.0k')).toBeInTheDocument();
  });

  it('toggles back to percentage on second click', async () => {
    render(<TokenMeter totalTokens={1500} contextWindow={10000} />);
    await userEvent.click(screen.getByText('15%'));
    expect(screen.getByText('1.5k/10.0k')).toBeInTheDocument();
    await userEvent.click(screen.getByText('1.5k/10.0k'));
    expect(screen.getByText('15%')).toBeInTheDocument();
  });

  it('shows all token usage details in the tooltip', async () => {
    render(
      <TokenMeter
        promptTokens={1200}
        completionTokens={300}
        totalTokens={1500}
        cacheReadTokens={800}
        cacheWriteTokens={100}
        noCacheTokens={300}
        contextWindow={10000}
        modelName="Test Model"
      />,
    );

    await userEvent.hover(screen.getByRole('button', { name: 'Token usage: 15% of context window' }));

    const tooltip = await screen.findByRole('tooltip');
    const tooltipContent = within(tooltip);

    expect(tooltipContent.getByText('Test Model')).toBeInTheDocument();
    expect(tooltipContent.getByText('Prompt tokens')).toBeInTheDocument();
    expect(tooltipContent.getByText('Completion tokens')).toBeInTheDocument();
    expect(tooltipContent.getByText('Total tokens')).toBeInTheDocument();
    expect(tooltipContent.getByText('Cache read')).toBeInTheDocument();
    expect(tooltipContent.getByText('Cache write')).toBeInTheDocument();
    expect(tooltipContent.getByText('Not cached')).toBeInTheDocument();
    expect(tooltipContent.getByText('Context window')).toBeInTheDocument();
    expect(tooltipContent.getByText('10,000')).toBeInTheDocument();
  });

  const codexUsage = {
    last: { totalTokens: 5000, inputTokens: 4000, cachedInputTokens: 1200,
      cacheWriteInputTokens: 0, outputTokens: 1000, reasoningOutputTokens: 300 },
    total: { totalTokens: 25000, inputTokens: 20000, cachedInputTokens: 4000,
      cacheWriteInputTokens: 0, outputTokens: 5000, reasoningOutputTokens: 1500 },
    modelContextWindow: 20000,
  };

  it('uses Codex latest total for occupancy and labels cumulative usage separately', async () => {
    render(<TokenMeter codex codexUsage={codexUsage} totalTokens={19000} contextWindow={1000} />);
    expect(screen.getByText('25%')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Token usage: 25% of context window' });
    await userEvent.hover(button);
    const tooltip = within(await screen.findByRole('tooltip'));
    expect(tooltip.getByText('Latest input')).toBeInTheDocument();
    expect(tooltip.getByText('Latest cached input')).toBeInTheDocument();
    expect(tooltip.getByText('Latest reasoning output')).toBeInTheDocument();
    expect(tooltip.getByText('Thread total')).toBeInTheDocument();
    expect(tooltip.getByText('25,000')).toBeInTheDocument();
    await userEvent.click(button);
    expect(screen.getByText('5.0k/20.0k')).toBeInTheDocument();
  });

  it('does not fabricate a Codex percentage when the window or usage is missing', () => {
    const { rerender } = render(<TokenMeter codex codexUsage={{ ...codexUsage, modelContextWindow: null }} />);
    expect(screen.getByText('5.0k/?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Codex context usage: unknown' })).toBeInTheDocument();
    rerender(<TokenMeter codex codexUsage={{ ...codexUsage, last: { ...codexUsage.last, inputTokens: -1 } }} />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('25%')).not.toBeInTheDocument();
  });

  it('renders SVG ring indicator', () => {
    const { container } = render(<TokenMeter />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg?.getAttribute('viewBox')).toBe('0 0 20 20');
  });

  it('uses normal ring color for low usage', () => {
    const { container } = render(
      <TokenMeter totalTokens={1000} contextWindow={10000} />,
    );
    const progressRing = container.querySelectorAll('circle')[1];
    expect(progressRing?.className.baseVal ?? progressRing?.getAttribute('class') ?? '').toContain('text-primary');
  });

  it('uses warning ring color for 40%+ usage', () => {
    const { container } = render(
      <TokenMeter totalTokens={5000} contextWindow={10000} />,
    );
    const progressRing = container.querySelectorAll('circle')[1];
    const cls = progressRing?.className.baseVal ?? progressRing?.getAttribute('class') ?? '';
    expect(cls).toContain('text-warning');
  });

  it('uses critical ring color for 60%+ usage', () => {
    const { container } = render(
      <TokenMeter totalTokens={7000} contextWindow={10000} />,
    );
    const progressRing = container.querySelectorAll('circle')[1];
    const cls = progressRing?.className.baseVal ?? progressRing?.getAttribute('class') ?? '';
    expect(cls).toContain('text-destructive');
  });

  it('formats large numbers compactly', async () => {
    render(<TokenMeter totalTokens={1500000} contextWindow={2000000} />);
    await userEvent.click(screen.getByText('75%'));
    expect(screen.getByText('1.5M/2.0M')).toBeInTheDocument();
  });

  it('shows 0/0 when no context and clicked', async () => {
    render(<TokenMeter />);
    await userEvent.click(screen.getByText('0%'));
    expect(screen.getByText('0/0')).toBeInTheDocument();
  });
});
