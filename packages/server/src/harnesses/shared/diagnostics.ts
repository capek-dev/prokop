/**
 * Server-log diagnostics for the native CLI harnesses. Failures are sent to
 * the prompting connection only, which may be gone (queued prompts) and
 * deliberately omits upstream detail, so the server log is the one place a
 * failed turn can be debugged. Never logs prompt or reply content.
 */

export type HarnessName = 'claude-cli' | 'codex-cli';

const MAX_TEXT = 400;
const STACK_FRAMES = 4;
const STDERR_TAIL_BYTES = 2_000;

function bounded(text: string, limit = MAX_TEXT): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/** Error type, bounded message, upstream detail when present, and the top stack frames. */
export function describeError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { errorType: typeof error, error: bounded(String(error)) };
  const frames = error.stack?.split('\n').slice(1, 1 + STACK_FRAMES).map((line) => line.trim());
  const detail = (error as { detail?: unknown }).detail;
  return {
    errorType: error.name,
    error: bounded(error.message),
    ...(typeof detail === 'string' && detail ? { detail: bounded(detail) } : {}),
    ...(frames?.length ? { stack: frames } : {}),
  };
}

export function logHarness(
  harness: HarnessName,
  event: string,
  fields: Record<string, unknown>,
  level: 'info' | 'warn' = 'warn',
): void {
  (level === 'info' ? console.log : console.warn)(`[${harness}] ${event}`, fields);
}

/** Keeps the last bytes a CLI process wrote to stderr, for failure logs. */
export class StderrTail {
  private text = '';

  push(chunk: string): void {
    this.text = (this.text + chunk).slice(-STDERR_TAIL_BYTES);
  }

  /** Trimmed tail, or undefined when the process wrote nothing. */
  read(): string | undefined {
    const trimmed = this.text.trim();
    return trimmed || undefined;
  }
}
