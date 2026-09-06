import { afterEach, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { getSharedHighlighter } from '@pierre/diffs';
import { RebaseConflictHunks } from '@/components/files/RebaseConflictHunks';
import { preloadPierreDiffsHighlighter } from '@/lib/pierreDiffsPreload';

afterEach(() => vi.restoreAllMocks());

test('real Kotlin merge panes render syntax tokens and update the center after a choice', async () => {
  // happy-dom has no canvas implementation; only text measurement is stubbed.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ font: '', measureText: (text: string) => ({ width: text.length * 8 }) } as unknown as CanvasRenderingContext2D);
  preloadPierreDiffsHighlighter();
  await getSharedHighlighter({ langs: ['kotlin'], themes: ['github-dark', 'github-light'] });
  const { container } = render(<RebaseConflictHunks fileName="Engine.kt" draft={'fun classify() {\n<<<<<<< base\n  val incoming = true\n=======\n  val feature = false\n>>>>>>> feature\n}\n'} disabled={false} onChange={() => {}} />);
  const panes = container.querySelectorAll('diffs-container');
  expect(panes).toHaveLength(3);
  await waitFor(() => expect(panes[0].shadowRoot?.textContent).toContain('incoming'));
  expect(panes[0].shadowRoot?.querySelectorAll('span[style]').length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button', { name: 'Use your change ↑' }));
  await waitFor(() => {
    const result = container.querySelectorAll('diffs-container')[1].shadowRoot?.textContent;
    expect(result).toContain('val feature');
    expect(result).not.toContain('<<<<<<<');
  });
  expect(screen.getByText('Conflict 1 of 1 · 0 unresolved')).toBeInTheDocument();
});
