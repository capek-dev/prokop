/**
 * Scripted turns. Only the model is scripted; every tool call runs for real
 * against the demo repo. Steps are queued as sandbox auto-responder rules
 * scoped to one session and consumed in order (`maxUses: 1`).
 */
import { followAttention, ProkopaiClient } from '../../packages/sdk/src';
import type { SandboxResponse } from '../../packages/server/src/infrastructure/sandbox/types';

export type Step = SandboxResponse;

interface Rule {
  match: { mode?: 'stream' | 'generate'; sessionId?: string };
  response: SandboxResponse;
  maxUses?: number;
  label?: string;
}

export class Demo {
  readonly client: ProkopaiClient;

  constructor(readonly url: string) {
    this.client = new ProkopaiClient({ url });
  }

  get rest() {
    return this.client.http;
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  async disconnect(): Promise<void> {
    await this.client.disconnect();
  }

  private async hasPendingCall(sessionId: string): Promise<boolean> {
    const response = await fetch(`${this.url}/api/sandbox/pending`);
    const pending = (await response.json()) as Array<{ sessionId: string }>;
    return pending.some((call) => call.sessionId === sessionId);
  }

  private async rules(): Promise<Rule[]> {
    const response = await fetch(`${this.url}/api/sandbox/auto-responder`);
    return (await response.json()) as Rule[];
  }

  private async setRules(rules: Rule[]): Promise<void> {
    const response = await fetch(`${this.url}/api/sandbox/auto-responder`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rules }),
    });
    if (!response.ok) throw new Error(`Setting sandbox rules failed: ${response.status}`);
  }

  /**
   * Answers background generate calls (titles, summaries) for this session
   * with a fixed text so nothing reads "Summary of the conversation so far".
   */
  async scriptTitle(sessionId: string, title: string): Promise<void> {
    const rule: Rule = { label: `title ${sessionId}`, match: { mode: 'generate', sessionId }, response: { type: 'text', content: title } };
    await this.setRules([rule, ...(await this.rules())]);
  }

  /**
   * Sends a user message and waits until every scripted step ran and the
   * session is idle. `until` stops earlier and leaves the session running:
   * - `running`: at the model call after the last step, which stays pending.
   * - `ask`: at the permission ask the last step's tool raises, left unanswered.
   */
  async runTurn(sessionId: string, prompt: string, steps: Step[], options: { until?: 'idle' | 'running' | 'ask'; timeoutMs?: number } = {}): Promise<void> {
    const { until = 'idle', timeoutMs = 60_000 } = options;
    const queued: Rule[] = steps.map((response, index) => ({
      label: `${sessionId} step ${index + 1}`,
      match: { mode: 'stream', sessionId },
      response,
      maxUses: 1,
    }));
    const existing = await this.rules();
    // Session-scoped rules go first so the catch-all generate rule cannot shadow them.
    await this.setRules([...queued, ...existing]);

    let rejection: string | null = null;
    const onRejected = (message: { sessionId?: string; reason?: string; message?: string }) => {
      if (message.sessionId === sessionId) rejection = JSON.stringify(message);
    };
    const onError = (code: string, message: string, errorSessionId?: string) => {
      if (!errorSessionId || errorSessionId === sessionId) rejection = `${code}: ${message}`;
    };
    // Asks go only to the session's controlling client, so watch the
    // server-wide attention feed, which lists every pending ask.
    let asked = false;
    const attention = new AbortController();
    if (until === 'ask') {
      void followAttention(this.url, undefined, (snapshot) => {
        if (snapshot.asks.some((ask) => ask.sessionId === sessionId)) asked = true;
      }, attention.signal).catch(() => undefined);
    }
    this.client.on('chat.rejected', onRejected);
    this.client.on('error', onError);
    this.client.chat.send(sessionId, prompt);

    try {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (rejection) throw new Error(`Scripted turn for ${sessionId} was rejected: ${rejection}`);
        await Bun.sleep(250);
        const remaining = (await this.rules()).filter((rule) => rule.match.mode === 'stream' && rule.match.sessionId === sessionId);
        if (remaining.length > 0) continue;
        if (until === 'ask') {
          if (asked) return;
          continue;
        }
        if (until === 'running') {
          if (await this.hasPendingCall(sessionId)) return;
          continue;
        }
        const { session } = await this.rest.sessions.get(sessionId);
        if (!session.runningAt) return;
      }
      throw new Error(`Scripted turn for ${sessionId} did not reach '${until}' within ${timeoutMs}ms`);
    } finally {
      this.client.off('chat.rejected', onRejected);
      this.client.off('error', onError);
      attention.abort();
    }
  }
}
