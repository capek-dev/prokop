interface TerminalOutputProps {
  command?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}

/**
 * Tonally themed terminal output. Follows the app surface tokens instead of a
 * hardcoded black panel so it reads correctly in light/dark and every scheme.
 */
export function TerminalOutput({ command, stdout, stderr, exitCode }: TerminalOutputProps) {
  const hasHeader = command !== undefined || exitCode !== undefined;
  const isSuccess = (exitCode ?? 0) === 0;

  if (!hasHeader) {
    if (!stdout && !stderr) return null;
    return (
      <div className="visualization-container rounded-md border border-border/60 bg-muted/50 px-3 py-2 font-mono text-xs overflow-x-auto">
        {stdout && <pre className="whitespace-pre-wrap text-foreground/80">{stdout}</pre>}
        {stderr && <pre className="whitespace-pre-wrap mt-1 text-destructive">{stderr}</pre>}
      </div>
    );
  }

  return (
    <div className="visualization-container border border-border/60 rounded-md overflow-hidden">
      <div className="bg-muted px-3 py-2 flex items-center justify-between">
        <div className="font-mono text-xs text-muted-foreground truncate flex-1 mr-2">
          <span>$ </span>
          <span className="text-foreground">{command}</span>
        </div>
        <span
          className={`text-xs font-mono px-2 py-0.5 rounded tabular-nums ${
            isSuccess
              ? 'bg-muted text-muted-foreground'
              : 'bg-destructive/10 text-destructive'
          }`}
        >
          [{exitCode}]
        </span>
      </div>

      {(stdout || stderr) && (
        <div className="bg-muted/50 px-3 py-2 font-mono text-xs overflow-x-auto">
          {stdout && (
            <pre className="whitespace-pre-wrap text-foreground/80">{stdout}</pre>
          )}
          {stderr && (
            <pre className="whitespace-pre-wrap mt-1 text-destructive">{stderr}</pre>
          )}
        </div>
      )}
    </div>
  );
}
