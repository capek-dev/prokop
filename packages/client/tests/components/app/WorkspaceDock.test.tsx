import { render } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { WorkspaceDock } from '@/components/app/WorkspaceDock';

describe('WorkspaceDock', () => {
  test('places left beside the center, right beside center, and bottom below both', () => {
    const { getByTestId } = render(
      <WorkspaceDock
        left={<div data-testid="left" />}
        center={<div data-testid="center" />}
        right={<div data-testid="right" />}
        bottom={<div data-testid="bottom" />}
      />,
    );
    const left = getByTestId('left');
    const center = getByTestId('center');
    const right = getByTestId('right');
    const bottom = getByTestId('bottom');
    const centerRow = center.parentElement;
    const primary = centerRow?.parentElement;

    expect(centerRow).toHaveAttribute('data-slot', 'workspace-center-row');
    expect(right.parentElement).toBe(centerRow);
    expect(bottom.parentElement).toBe(primary);
    expect(left.parentElement).toBe(primary?.parentElement);
    expect((centerRow?.compareDocumentPosition(bottom) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(primary).not.toContainElement(left);
  });

  test('supports a center without peripheral docks', () => {
    const { getByRole, getByText } = render(<WorkspaceDock center={<span>Conversation</span>} />);
    expect(getByRole('main')).toContainElement(getByText('Conversation'));
    expect(getByRole('main')).toHaveClass('min-h-0', 'min-w-0', 'overflow-hidden');
  });
});
