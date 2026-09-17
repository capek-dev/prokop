import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SelectedContextRecord } from '@prokopai/sdk';
import { SelectedContext, SelectedContextDetails } from '@/components/chat/SelectedContext';

const { getSelectedContext } = vi.hoisted(() => ({ getSelectedContext: vi.fn() }));
vi.mock('@/contexts/ServerClientContext', () => ({ useServerClient: () => ({ serverUrl: 'https://server.test', sdkClient: { http: { sessions: { getSelectedContext } } } }) }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const record: SelectedContextRecord = {
  sessionId: 'session', assistantMessageId: 'response', continuation: false, createdAt: '2026-01-01',
  outcome: 'selected', threshold: 2, elapsedMs: 1, excluded: [], items: [
    { id: 'memory', kind: 'memory', source: 'workspace', name: 'MEMORY.md', revision: 'memory-revision', content: 'Included memory', inclusion: 'selected', score: 3 },
    { id: 'skill', kind: 'skill', source: 'agent', name: 'Test skill', description: 'Skill description', revision: 'skill-revision', content: 'Included skill body', inclusion: 'preloaded', score: 2.5 },
  ],
};

describe('Selected context', () => {
  it('defers fetch and skill mounting until expanded; drops cache on close', async () => {
    getSelectedContext.mockResolvedValue({ record });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><SelectedContext sessionId="session" messageId="response" /></QueryClientProvider>);
    expect(getSelectedContext).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Selected context' })).toHaveTextContent('Context');
    fireEvent.click(screen.getByRole('button', { name: 'Selected context' }));
    expect(await screen.findByText('Included memory')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Selected context' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Memories' })).toBeTruthy();
    expect(screen.queryByText('Included skill body')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Test skill' }));
    expect(screen.getByText('Included skill body')).toBeTruthy();
    expect(screen.queryByText(/memory-revision/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Technical details' }));
    expect(screen.getByText(/memory-revision/)).toBeTruthy();
    expect(getSelectedContext).toHaveBeenCalledWith('session', 'response', { signal: expect.any(AbortSignal) });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(client.getQueryCache().getAll()).toHaveLength(0));
    client.clear();
  });
  it('shows probability decisions while preserving legacy score labels', () => {
    const view = render(<SelectedContextDetails record={{ ...record, requiredProbability: 0.7,
      items: [{ ...record.items[0], score: 1.7, qualifyingProbability: 0.7 }],
      excluded: [{ id: 'other', name: 'Other', source: 'agent', score: 1.6, qualifyingProbability: 0.6, reason: 'threshold' }],
    }} />);
    expect(screen.getByText('70.0% at level 2 or above')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Technical details' }));
    expect(screen.getByText(/Minimum level: 2 · Required probability: 70%/)).toBeTruthy();
    expect(screen.getByText(/60.0% at level 2 or above · Below required probability/)).toBeTruthy();
    view.rerender(<SelectedContextDetails record={record} />);
    expect(screen.getByText(/Threshold: 2/)).toBeTruthy();
    expect(screen.getByText('3.0 / 3')).toBeTruthy();
  });
  it('formats memory markdown instead of showing raw syntax', () => {
    render(<SelectedContextDetails record={{ ...record, items: [{ ...record.items[0], content: '- Use **React** for frontend work' }] }} />);
    expect(screen.getByRole('listitem')).toHaveTextContent('Use React for frontend work');
    expect(screen.getByText('React').tagName).toBe('STRONG');
  });
  it('distinguishes empty selection and timeout from provider delivery', () => {
    const view = render(<SelectedContextDetails record={{ ...record, items: [], continuation: true }} />);
    expect(screen.getByText(/0 memories selected/)).toBeTruthy();
    expect(screen.getByText(/not proof that the provider received/)).toBeTruthy();
    expect(screen.getByText(/Compaction continuation/)).toBeTruthy();
    view.rerender(<SelectedContextDetails record={{ ...record, outcome: 'timeout' }} />);
    expect(screen.getByText(/Selection timed out. Standard memory context used/)).toBeTruthy();
    expect(screen.queryByText(/0 memories selected/)).toBeNull();
  });
  it('shows missing historical snapshot and offers retry after transport failure', async () => {
    getSelectedContext.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ record: null });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><SelectedContext sessionId="session" messageId="old" /></QueryClientProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Selected context' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No context snapshot was recorded for this response.')).toBeTruthy();
    client.clear();
  });
});
