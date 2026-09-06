import { useState } from 'react';
import { expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { RebaseConflictHunks } from '@/components/files/RebaseConflictHunks';
vi.mock('@/components/editor/PierreCodeEditor', () => ({ PierreCodeEditor: ({ value, onChange, saving, fileName }: { value: string; onChange: (text: string) => void; saving: boolean; fileName: string }) => <textarea aria-label={saving ? `Input ${fileName}` : 'Result code'} readOnly={saving} value={value} onChange={(e) => onChange(e.target.value)} /> }));
const block = '<<<<<<< base\nbase code\n=======\nfeature code\n>>>>>>> feature\n';
function Editor() {
  const [draft, setDraft] = useState(`before\n${block}middle\n${block}after\n`);
  return <><RebaseConflictHunks fileName="Engine.kt" draft={draft} disabled={false} onChange={setDraft} /><output data-testid="draft">{draft}</output></>;
}
test('keeps resolved section visible and permits changing the choice', () => {
  render(<Editor />);
  fireEvent.click(screen.getByRole('button', { name: 'Use incoming version ↓' }));
  expect(screen.getByText('Conflict 1 of 2 · 1 unresolved')).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Result code' })).toHaveValue('before\nbase code\nmiddle\n');
  fireEvent.click(screen.getByRole('button', { name: 'Use your change ↑' }));
  expect(screen.getByTestId('draft').textContent).toBe(`before\nfeature code\nmiddle\n${block}after\n`);
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  fireEvent.click(screen.getByRole('button', { name: 'Keep both, incoming first' }));
  expect(screen.getByTestId('draft').textContent).toBe('before\nfeature code\nmiddle\nbase code\nfeature code\nafter\n');
});
test('editing middle pane updates real draft including context without an Apply step', () => {
  render(<Editor />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Result code' }), { target: { value: 'before\ncustom\nmiddle\n' } });
  expect(screen.getByTestId('draft').textContent).toBe(`before\ncustom\nmiddle\n${block}after\n`);
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
  expect(screen.getByRole('textbox', { name: 'Result code' })).toHaveValue('before\ncustom\nmiddle\n');
});
test('empty side is explained and redundant keep-both is absent', () => {
  render(<RebaseConflictHunks fileName="Engine.kts" draft={'fun test() {\n<<<<<<< base\n=======\n  ateMix = ateMix,\n>>>>>>> feature\n}\n'} disabled={false} onChange={() => {}} />);
  expect(screen.getByText('Incoming version has no lines in the conflicting range.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Keep both/ })).not.toBeInTheDocument();
  expect(screen.getAllByRole('textbox', { name: 'Input Engine.kts' })[0]).toHaveValue('fun test() {\n}\n');
});
