import { query, type ModelInfo } from '@anthropic-ai/claude-agent-sdk';
import { claudeCliVersion } from './version';

/** Initialize the installed CLI without yielding a prompt or creating a conversation. */
export async function probeClaudeModels(): Promise<ModelInfo[]> {
  claudeCliVersion();
  const executable = Bun.which('claude');
  if (!executable) throw new Error('Claude CLI is unavailable on this host');
  const { ANTHROPIC_API_KEY: _apiKey, ANTHROPIC_AUTH_TOKEN: _authToken,
    CLAUDE_CODE_USE_BEDROCK: _bedrock, CLAUDE_CODE_USE_VERTEX: _vertex,
    CLAUDE_CODE_USE_FOUNDRY: _foundry, ...env } = process.env;
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 25_000);
  const q = query({
    // A never-yielding prompt is intentional: discovery must not send a model request.
    // eslint-disable-next-line require-yield
    prompt: (async function* () { await new Promise<void>(resolve => {
      if (abort.signal.aborted) resolve();
      else abort.signal.addEventListener('abort', () => resolve(), { once: true });
    }); })(),
    options: {
      pathToClaudeCodeExecutable: executable,
      abortController: abort,
      persistSession: false,
      settingSources: [],
      settings: { disableAllHooks: true },
      allowedTools: [],
      mcpServers: {},
      strictMcpConfig: true,
      permissionMode: 'dontAsk',
      env: { ...env, ENABLE_CLAUDEAI_MCP_SERVERS: 'false', CLAUDE_CODE_AUTO_CONNECT_IDE: '0' },
    },
  });
  try {
    const initialized = await Promise.race([
      q.initializationResult(),
      new Promise<never>((_, reject) => {
        const expired = () => reject(new Error('Claude model discovery timed out'));
        if (abort.signal.aborted) expired();
        else abort.signal.addEventListener('abort', expired, { once: true });
      }),
    ]);
    const models = initialized.models;
    if (abort.signal.aborted) throw new Error('Claude model discovery timed out');
    return models;
  } finally {
    clearTimeout(timeout);
    abort.abort();
  }
}
