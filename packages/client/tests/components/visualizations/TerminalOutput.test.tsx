import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { TerminalOutput } from '@/components/visualizations/TerminalOutput';

describe('TerminalOutput', () => {
  it('renders command with $ prompt', () => {
    render(<TerminalOutput command="npm test" exitCode={0} />);
    expect(screen.getByText('$')).toBeInTheDocument();
    expect(screen.getByText('npm test')).toBeInTheDocument();
  });

  it('renders exit code in brackets', () => {
    render(<TerminalOutput command="ls" exitCode={0} />);
    expect(screen.getByText('[0]')).toBeInTheDocument();
  });

  it('shows error styling for non-zero exit code', () => {
    render(<TerminalOutput command="fail" exitCode={1} />);
    const exitBadge = screen.getByText('[1]');
    expect(exitBadge.className).toContain('bg-destructive/10');
    expect(exitBadge.className).toContain('text-destructive');
  });

  it('shows muted styling for zero exit code', () => {
    render(<TerminalOutput command="ls" exitCode={0} />);
    const exitBadge = screen.getByText('[0]');
    expect(exitBadge.className).toContain('bg-muted');
  });

  it('renders stdout when provided', () => {
    render(<TerminalOutput command="echo hello" exitCode={0} stdout="hello" />);
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('renders stderr when provided', () => {
    render(<TerminalOutput command="err" exitCode={1} stderr="error occurred" />);
    const stderrEl = screen.getByText('error occurred');
    expect(stderrEl.className).toContain('text-destructive');
  });

  it('renders both stdout and stderr', () => {
    render(
      <TerminalOutput
        command="cmd"
        exitCode={1}
        stdout="output"
        stderr="error"
      />,
    );
    expect(screen.getByText('output')).toBeInTheDocument();
    expect(screen.getByText('error')).toBeInTheDocument();
  });

  it('hides output section when no stdout or stderr', () => {
    const { container } = render(
      <TerminalOutput command="noop" exitCode={0} />,
    );
    const outputSection = container.querySelector('pre');
    expect(outputSection).not.toBeInTheDocument();
  });

  it('renders nothing for whitespace-only output (no header)', () => {
    const { container } = render(<TerminalOutput stdout="   " />);
    expect(container.querySelector('pre')).not.toBeInTheDocument();
  });

  it('renders no output body for whitespace-only stdout with header', () => {
    const { container } = render(<TerminalOutput command="silent-cmd" exitCode={0} stdout="   " />);
    expect(screen.getByText('silent-cmd')).toBeInTheDocument();
    expect(container.querySelector('pre')).not.toBeInTheDocument();
  });

  it('applies font-mono to command area', () => {
    render(<TerminalOutput command="test" exitCode={0} />);
    const commandArea = screen.getByText('test').closest('div');
    expect(commandArea?.className).toContain('font-mono');
  });

  it('caps output body height with an inner scroll area (header variant)', () => {
    const { container } = render(
      <TerminalOutput command="cat big-file.ts" exitCode={0} stdout={'line\n'.repeat(200)} />,
    );
    const scrollBody = container.querySelector('.tool-output-scroll');
    expect(scrollBody).toBeInTheDocument();
    // Command header stays outside the scroll area.
    expect(screen.getByText('cat big-file.ts').closest('.tool-output-scroll')).toBeNull();
  });

  it('caps output body height with an inner scroll area (no header variant)', () => {
    const { container } = render(
      <TerminalOutput stdout={'line\n'.repeat(200)} />,
    );
    expect(container.querySelector('.tool-output-scroll')).toBeInTheDocument();
  });
});
