interface TerminalOutputProps {
  command?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}

export function TerminalOutput({ command, stdout, stderr, exitCode }: TerminalOutputProps) {
  const hasHeader = command !== undefined || exitCode !== undefined;
  const isSuccess = (exitCode ?? 0) === 0;

  if (!hasHeader) {
    if (!stdout && !stderr) return null;
    return (
      <div className="visualization-container bg-black rounded-md px-3 py-2 font-mono text-xs overflow-x-auto">
        {stdout && <pre className="text-gray-300 whitespace-pre-wrap">{stdout}</pre>}
        {stderr && <pre className="text-red-400 whitespace-pre-wrap mt-1">{stderr}</pre>}
      </div>
    );
  }

  return (
    <div className="visualization-container border border-border rounded-md overflow-hidden">
      <div className="bg-muted px-3 py-2 flex items-center justify-between">
        <div className="font-mono text-xs text-muted-foreground truncate flex-1 mr-2">
          <span className="text-muted-foreground">$ </span>
          <span className="text-foreground">{command}</span>
        </div>
        <span
          className={`text-xs font-mono px-2 py-0.5 rounded ${
            isSuccess ? 'bg-muted text-muted-foreground' : 'bg-red-500/20 text-red-400'
          }`}
        >
          [{exitCode}]
        </span>
      </div>

      {(stdout || stderr) && (
        <div className="bg-black px-3 py-2 font-mono text-xs overflow-x-auto">
          {stdout && (
            <pre className="text-gray-300 whitespace-pre-wrap">{stdout}</pre>
          )}
          {stderr && (
            <pre className="text-red-400 whitespace-pre-wrap mt-1">{stderr}</pre>
          )}
        </div>
      )}
    </div>
  );
}
