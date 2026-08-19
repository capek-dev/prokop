/**
 * Windows PowerShell does not translate \n to \r\n even in cooked mode,
 * unlike CMD. This causes progressive rightward cursor drift (staircase)
 * with @clack/prompts' log.step(), spinner.stop(), etc., which all use
 * process.stdout.write(text + '\n').
 *
 * Additionally, @clack/core's block() and Prompt.close() intentionally
 * leave stdin in raw mode on Windows (workaround for clack#176), which
 * further desyncs PSReadLine's cursor tracking.
 *
 * This module patches both process.stdout.write AND console.log to ensure
 * \r\n line endings on Windows, and provides restoreTerminalState() to
 * exit raw mode after prompts.
 */

if (process.platform === 'win32' && process.stdout.isTTY) {
  // Patch process.stdout.write — covers @clack/prompts and direct calls
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const _origStdoutWrite: (data: string | Uint8Array, ...args: any[]) => boolean =
    process.stdout.write.bind(process.stdout);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const patchedWrite = (data: string | Uint8Array, ...args: any[]): boolean => {
    if (typeof data === 'string') {
      data = data.replace(/(?<!\r)\n/g, '\r\n');
    }
    return _origStdoutWrite(data, ...args);
  };
  (process.stdout as unknown as { write: typeof patchedWrite }).write = patchedWrite;

  // Patch console.log — Bun's console.log writes directly to fd 1,
  // bypassing process.stdout.write entirely, so we must intercept it
  // separately to ensure \r\n line endings.
  const _origLog = console.log;
  (console as unknown as { log: typeof _origLog }).log = (...args: unknown[]): void => {
    const msg = args.map((a) => (typeof a === 'string' ? a : String(a))).join(' ');
    process.stdout.write(msg + '\n');
  };
}

/**
 * On Windows, @clack/core's block() and Prompt.close() intentionally leave
 * stdin in raw mode (workaround for clack#176). Call this after every
 * await confirm/select/multiselect and after every spinner.stop().
 */
export function restoreTerminalState(): void {
  if (process.platform === 'win32' && process.stdin.isTTY) {
    try {
      process.stdin.setRawMode(false);
      process.stdout.write('\r');
    } catch {
      // Ignore — may fail if stdin was already restored or is not a TTY
    }
  }
}
