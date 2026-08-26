import { render } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { WorkspaceDock } from '@/components/app/WorkspaceDock';

function renderDock() {
  return render(
    <WorkspaceDock
      sessions={<div data-testid="sessions" />}
      content={<div data-testid="content" />}
      panels={<div data-testid="panels" />}
    />,
  );
}

describe('WorkspaceDock', () => {
  test('renders Sessions and Primary in one flush dock surface', () => {
    const { getByTestId } = renderDock();
    const row = getByTestId('sessions').parentElement;
    const shell = row?.parentElement;

    expect(shell).toHaveAttribute('data-slot', 'workspace-dock');
    expect(shell).toHaveClass('flex-col', 'overflow-hidden', 'border-t', 'border-border', 'bg-background');
    expect(shell).not.toHaveClass('rounded-xl', 'shadow-sm', 'ring-1');
    expect(shell?.parentElement).not.toHaveClass('p-2');
    expect(row).toHaveAttribute('data-slot', 'workspace-dock-row');
    expect(shell?.querySelector('[data-slot="workspace-bar"]')).toBeNull();
  });

  test('keeps utility panels below primary content and outside Sessions', () => {
    const { getByTestId } = renderDock();
    const content = getByTestId('content');
    const panels = getByTestId('panels');
    const sessions = getByTestId('sessions');
    const primaryDock = content.parentElement;

    expect(primaryDock).toHaveAttribute('data-slot', 'workspace-primary-dock');
    expect(primaryDock).toContainElement(panels);
    expect(primaryDock).not.toContainElement(sessions);
    expect(sessions.parentElement).toBe(primaryDock?.parentElement);
    expect(content.compareDocumentPosition(panels) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
