/** Arguments for a text-only, noninteractive turn in the user's installed CLI. */
export function claudeTextTurnArgs(resumeSessionId?: string, model = 'sonnet', effort = 'high', sessionId?: string): string[] {
  if (!(/^claude-[a-z0-9-]{1,180}$/.test(model) || ['sonnet', 'opus', 'haiku'].includes(model)) || !['default', 'low', 'medium', 'high', 'xhigh', 'max'].includes(effort)) {
    throw new Error('Unsupported Claude CLI model or effort');
  }
  if (sessionId && resumeSessionId) throw new Error('Claude session identity is ambiguous');
  if (sessionId && !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(sessionId)) throw new Error('Invalid Claude session identity');
  if (resumeSessionId !== undefined && !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(resumeSessionId)) {
    throw new Error('Invalid Claude CLI resume identity');
  }
  return [
    'claude', '--print', '--output-format', 'stream-json', '--verbose',
    // Unlike --bare, safe mode leaves the user's local Claude Code login intact.
    '--safe-mode', '--strict-mcp-config', '--permission-mode', 'dontAsk',
    '--permission-prompts', 'none', '--tools', '',
    '--disable-slash-commands', '--model', model,
    ...(effort === 'default' ? [] : ['--effort', effort]),
    ...(resumeSessionId ? ['--resume', resumeSessionId] : ['--session-id', sessionId ?? crypto.randomUUID()]),
  ];
}
