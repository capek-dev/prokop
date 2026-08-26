import { render } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { WorkspacePrimarySurface } from '@/components/app/WorkspacePrimarySurface';

describe('WorkspacePrimarySurface', () => {
  test('owns the primary header above Chat or Board content', () => {
    const { getByTestId } = render(
      <WorkspacePrimarySurface header={<div data-testid="primary-header" />}>
        <div data-testid="primary-content" />
      </WorkspacePrimarySurface>,
    );

    const header = getByTestId('primary-header');
    const content = getByTestId('primary-content');
    const surface = header.parentElement;

    expect(surface).toHaveAttribute('data-slot', 'workspace-primary-surface');
    expect(surface).toContainElement(content);
    expect(header.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
