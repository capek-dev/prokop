import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import type { GetToolDebugResponse, ProkopaiClient, ToolPart } from '@prokopai/sdk';
import { ToolCall } from '@/components/chat/ToolCall';
import { ServerClientProvider } from '@/contexts/ServerClientContext';

function makeProjectedPart(): ToolPart {
  return {
    id: 'part-1',
    messageId: 'message-1',
    createdAt: 1,
    type: 'tool',
    callId: 'call-1',
    name: 'shell',
    state: {
      status: 'completed',
      input: {},
      output: null,
      startedAt: 1,
      completedAt: 2,
    },
    presentation: {
      summary: 'echo hello',
      debugAvailable: true,
    },
  };
}

describe('ToolCall debug loading', () => {
  test('fetches raw input and output only after expansion', async () => {
    let resolveDebug!: (value: GetToolDebugResponse) => void;
    const debugPromise = new Promise<GetToolDebugResponse>((resolve) => {
      resolveDebug = resolve;
    });
    let debugRequests = 0;
    const sdkClient = {
      http: {
        tools: {
          list: async () => ({ tools: [] }),
        },
        sessions: {
          getToolDebug: async () => {
            debugRequests += 1;
            return debugPromise;
          },
        },
      },
    } as unknown as ProkopaiClient;
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ServerClientProvider value={{
          sdkClient,
          serverUrl: 'http://localhost',
          apiToken: null,
          connected: true,
        }}>
          <ToolCall
            sessionId="session-1"
            part={makeProjectedPart()}
            pendingAskRequests={[]}
            onAskResponse={() => {}}
          />
        </ServerClientProvider>
      </QueryClientProvider>,
    );

    expect(debugRequests).toBe(0);
    const summary = screen.getByText(': echo hello');
    expect(summary).toBeInTheDocument();
    expect(summary.className).not.toContain('hidden');
    fireEvent.click(screen.getByText('shell'));
    expect(await screen.findByText('Loading raw data...')).toBeInTheDocument();
    expect(debugRequests).toBe(1);

    resolveDebug({
      input: { command: 'secret-input' },
      output: { content: 'secret-output' },
    });

    await waitFor(() => {
      expect(screen.getByText(/secret-input/)).toBeInTheDocument();
      expect(screen.getByText(/secret-output/)).toBeInTheDocument();
    });
  });

  test('opens a linked Codex child timeline from the agent row', async () => {
    const childId = '11111111-1111-4111-8111-111111111111';
    const opened: string[] = [];
    const part: ToolPart = { ...makeProjectedPart(), name: 'Codex agent',
      state: { status: 'completed', input: {}, output: null, startedAt: 1, completedAt: 2,
        childSessionId: childId },
      presentation: { summary: 'explorer', debugAvailable: false } };
    const sdkClient = { http: { tools: { list: async () => ({ tools: [] }) } } } as unknown as ProkopaiClient;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ServerClientProvider value={{ sdkClient, serverUrl: 'http://localhost', apiToken: null, connected: true }}>
          <ToolCall sessionId="session-1" part={part} pendingAskRequests={[]}
            onAskResponse={() => {}} onNavigateToSubagent={id => opened.push(id)} />
        </ServerClientProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'View session' }));
    expect(opened).toEqual([childId]);
  });
});
