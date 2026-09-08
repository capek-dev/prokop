import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { AnyVisualization, ToolPart } from '@prokopai/sdk';
import { ToolCall } from '@/components/chat/ToolCall';
import { ServerClientProvider } from '@/contexts/ServerClientContext';

const { renderPreview, debugQuery } = vi.hoisted(() => ({
  renderPreview: vi.fn(),
  debugQuery: vi.fn(() => ({})),
}));
vi.mock('@/hooks/queries', () => ({
  useToolDisplayCatalog: () => ({}),
  useToolDebugQuery: debugQuery,
}));
vi.mock('@/components/visualizations', () => ({
  VisualizationRenderer: ({ visualization }: { visualization: AnyVisualization }) => {
    renderPreview();
    return <div>{visualization.title}</div>;
  },
}));
vi.mock('@/components/visualizations/TerminalOutput', () => ({
  TerminalOutput: () => { renderPreview(); return <div>Shell preview</div>; },
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function makePart(id: string, collapsed = false): ToolPart {
  return {
    id, messageId: 'm', createdAt: 1, type: 'tool', callId: id, name: 'test-tool',
    state: { status: 'completed', input: {}, output: null, startedAt: 1, completedAt: 2 },
    presentation: {
      summary: 'Tool summary', debugAvailable: true,
      visualization: { type: 'markdown', content: 'body', title: 'Rich preview', collapsed },
    },
  };
}
const pendingAskRequests: [] = [];
const onAskResponse = () => {};
function view(part: ToolPart, collapsePreview: boolean) {
  return (
    <ServerClientProvider value={{ sdkClient: null, serverUrl: 'https://preview.test', apiToken: null, connected: false }}>
      <ToolCall sessionId="preview-session" part={part} collapsePreview={collapsePreview}
        pendingAskRequests={pendingAskRequests} onAskResponse={onAskResponse} />
    </ServerClientProvider>
  );
}

describe('historical tool previews', () => {
  test('opens old previews without debug fetches, including after remount', () => {
    const part = makePart('old-preview');
    const result = render(view(part, true));
    expect(renderPreview).not.toHaveBeenCalled();
    expect(debugQuery).toHaveBeenLastCalledWith(null, 'preview-session', part.id, false);
    fireEvent.click(screen.getByText('test-tool'));
    expect(screen.getByText('Rich preview')).toBeInTheDocument();
    expect(debugQuery).toHaveBeenLastCalledWith(null, 'preview-session', part.id, false);
    expect(screen.queryByText('Input')).not.toBeInTheDocument();
    const rawDataLink = screen.getByRole('button', { name: 'Show raw data' });
    expect(rawDataLink).toHaveAttribute('data-variant', 'link');
    fireEvent.click(rawDataLink);
    expect(debugQuery).toHaveBeenLastCalledWith(null, 'preview-session', part.id, true);
    result.unmount();
    render(view(part, true));
    expect(screen.getByText('Rich preview')).toBeInTheDocument();
    expect(debugQuery).toHaveBeenLastCalledWith(null, 'preview-session', part.id, false);
    fireEvent.click(screen.getByText('test-tool'));
    expect(screen.queryByText('Rich preview')).not.toBeInTheDocument();
  });

  test('a cutoff change updates a memoized tool with the same part identity', () => {
    const part = makePart('moving-cutoff');
    const result = render(view(part, false));
    expect(screen.getByText('Rich preview')).toBeInTheDocument();
    result.rerender(view(part, true));
    expect(screen.queryByText('Rich preview')).not.toBeInTheDocument();
    result.rerender(view(part, false));
    expect(screen.getByText('Rich preview')).toBeInTheDocument();
  });

  test('manual expansion stays visible when a recent tool becomes old', () => {
    const part = makePart('manual-choice');
    const result = render(view(part, false));
    fireEvent.click(screen.getByText('test-tool'));
    result.rerender(view(part, true));
    expect(screen.getAllByText('Rich preview')).toHaveLength(1);
  });

  test('tool-declared collapsed previews open without fetching debug', () => {
    const part = makePart('declared-collapsed', true);
    render(view(part, false));
    expect(renderPreview).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('test-tool'));
    expect(screen.getByText('Rich preview')).toBeInTheDocument();
    expect(debugQuery).toHaveBeenLastCalledWith(null, 'preview-session', part.id, false);
  });

  test('local raw data is also hidden until debug is requested', () => {
    const part = makePart('local-debug');
    part.presentation!.debugAvailable = false;
    render(view(part, true));
    fireEvent.click(screen.getByText('test-tool'));
    expect(screen.queryByText('Input')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show raw data' }));
    expect(screen.getByText('Input')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hide raw data' }));
    expect(screen.queryByText('Input')).not.toBeInTheDocument();
    expect(screen.getByText('Rich preview')).toBeInTheDocument();
  });

  test('shell output uses the same historical suppression', () => {
    const part = makePart('shell-preview');
    part.presentation!.visualization = { type: 'shell-output', command: 'echo hello', exitCode: 0, stdout: 'hello', stderr: '' };
    const result = render(view(part, false));
    expect(screen.getByText('Shell preview')).toBeInTheDocument();
    result.rerender(view(part, true));
    expect(screen.queryByText('Shell preview')).not.toBeInTheDocument();
  });
});
