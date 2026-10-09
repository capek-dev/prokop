import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { followAttention, type AttentionSnapshot } from '../src/attention';
import { AuthError } from '../src/errors';

const spies: Array<{ mockRestore(): void }> = [];
afterEach(() => spies.splice(0).forEach((spy) => spy.mockRestore()));

function stream(chunks: string[]): Response {
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  }), { headers: { 'Content-Type': 'text/event-stream' } });
}

const empty: AttentionSnapshot = { revision: 1, asks: [], running: [] };
const waiting: AttentionSnapshot = {
  revision: 2,
  asks: [{ id: 'a1', kind: 'approval', sessionId: 's1', sessionTitle: 'Deploy', workspaceId: 'w1', workspaceName: 'site', toolName: 'bash', createdAt: 1 }],
  running: [],
};

describe('followAttention', () => {
  test('delivers each snapshot event and sends the device token', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async () => stream([
      `event: snapshot\ndata: ${JSON.stringify(empty)}\n\n: keepalive\n\nevent: snap`,
      `shot\ndata: ${JSON.stringify(waiting)}\n\n`,
    ])) as unknown as typeof fetch);
    spies.push(fetchSpy);

    const snapshots: AttentionSnapshot[] = [];
    await followAttention('laptop:8742', 'pkd_x', (snapshot) => snapshots.push(snapshot));

    expect(snapshots).toEqual([empty, waiting]);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe('http://laptop:8742/api/attention/events');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer pkd_x');
  });

  test('an unpaired device gets AuthError', async () => {
    spies.push(spyOn(globalThis, 'fetch').mockImplementation((async () => new Response('', { status: 401 })) as unknown as typeof fetch));
    await expect(followAttention('laptop:8742', undefined, () => {})).rejects.toBeInstanceOf(AuthError);
  });
});
