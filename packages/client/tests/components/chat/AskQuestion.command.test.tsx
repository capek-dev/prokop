import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { ClassifiedPermissionAsk, PermissionAsk } from '@prokopai/sdk';
import { AskQuestion } from '@/components/chat/AskQuestion';

const command = 'grep -rl foo src | xargs rm -rf | head';
const markStart = command.indexOf('rm -rf');

function shellAsk(extra: Partial<ClassifiedPermissionAsk> = {}): ClassifiedPermissionAsk {
  return {
    type: 'permission',
    question: 'Allow Claude to run this command?',
    description: command,
    resource: 'shell-command',
    action: 'execute',
    risk: 'high',
    concerns: ['destructive'],
    catastrophic: false,
    evidence: ['under xargs: rm with a destructive flag'],
    highlights: [{ start: markStart, end: markStart + 6, reason: 'deletes recursively or without confirmation' }],
    commandSegments: [
      { start: 0, end: 16 },
      { start: 19, end: 31 },
      { start: 34, end: 38 },
    ],
    allowedScopes: ['once'],
    metadata: { command },
    ...extra,
  };
}

function renderAsk(ask: PermissionAsk, onRespond = vi.fn()) {
  const view = render(
    <AskQuestion request={{ toolCallId: 'call-1', sessionId: 'sess', toolName: 'claude-cli:Bash', ask }} onRespond={onRespond} />,
  );
  return { ...view, onRespond };
}

afterEach(cleanup);

describe('shell permission card', () => {
  test('shows the command once, one stage per line, with the flagged part marked', () => {
    const { container } = renderAsk(shellAsk());
    expect(container.querySelectorAll('pre')).toHaveLength(1);
    expect(screen.queryByText(command)).toBeNull();
    const lines = [...container.querySelectorAll('pre > div')].map(line => line.textContent);
    expect(lines).toEqual(['grep -rl foo src', '| xargs rm -rf', '| head']);
    expect([...container.querySelectorAll('pre mark')].map(mark => mark.textContent)).toEqual(['rm -rf']);
    expect(screen.getByText('deletes recursively or without confirmation')).toBeTruthy();
    // The reason replaces the concern chip and the raw evidence line.
    expect(screen.queryByText('Destructive')).toBeNull();
    expect(screen.queryByText('under xargs: rm with a destructive flag')).toBeNull();
  });

  test('stages without a highlight recede', () => {
    const { container } = renderAsk(shellAsk());
    const lines = [...container.querySelectorAll('pre > div')];
    expect(lines[0]!.className).toContain('text-muted-foreground');
    expect(lines[1]!.className).not.toContain('text-muted-foreground');
  });

  test('out-of-bounds spans fall back to the plain command and its chips', () => {
    const { container } = renderAsk(shellAsk({
      highlights: [{ start: 0, end: 999, reason: 'stale' }],
      commandSegments: [{ start: 0, end: 999 }],
    }));
    expect([...container.querySelectorAll('pre > div')].map(line => line.textContent)).toEqual([command]);
    expect(container.querySelector('pre mark')).toBeNull();
    expect(screen.queryByText('stale')).toBeNull();
  });

  test('without highlights the chips and evidence remain', () => {
    renderAsk(shellAsk({ highlights: [] }));
    expect(screen.getByText('Destructive')).toBeTruthy();
    expect(screen.getByText('under xargs: rm with a destructive flag')).toBeTruthy();
  });

  test('allow once is the primary action and block stays available', () => {
    const { onRespond } = renderAsk(shellAsk());
    const buttons = screen.getAllByRole('button').map(button => button.textContent);
    expect(buttons).toEqual(['Allow Once', 'Block']);
    fireEvent.click(screen.getByText('Block'));
    expect(onRespond).toHaveBeenCalledWith('call-1', { type: 'permission', grant: 'deny' }, undefined);
  });

  test('a description that is not the command still shows', () => {
    renderAsk(shellAsk({ description: 'Working directory: /ws' }));
    expect(screen.getByText('Working directory: /ws')).toBeTruthy();
  });
});
