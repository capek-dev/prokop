import { type FC, memo, useState, useMemo, useCallback } from 'react';
import { Check, FileText, AlertCircle, ChevronDown, ChevronRight, ExternalLink, Copy } from 'lucide-react';
import { Highlight, themes } from 'prism-react-renderer';
import { useUIStore } from '@/stores/uiStore';
import { useServerDataStore } from '@/stores/serverDataStore';
import { useTheme } from '@/components/providers/ThemeProvider';
import { cn } from '@/lib/utils';
import { pathBasename } from '@/lib/platform';
import { RENDER_BUDGETS } from '@/lib/renderBudgets';

const CODE_THEME_DARK = themes.oneDark;
const CODE_THEME_LIGHT = themes.oneLight;

interface CodeBlockProps {
  content: string;
  path: string;
  language?: string;
  created?: boolean;
  highlightLines?: number[];
  showOverwriteIndicator?: boolean;
}

function detectLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  const langMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    json: 'json',
    md: 'markdown',
    css: 'css',
    html: 'html',
    py: 'python',
    go: 'go',
    rs: 'rust',
    sh: 'bash',
    yaml: 'yaml',
    yml: 'yaml',
  };
  return langMap[ext || ''] || ext || 'text';
}

export const CodeBlock: FC<CodeBlockProps> = memo(({
  content,
  path,
  language,
  created,
  highlightLines = [],
}) => {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const openFilePreview = useUIStore((s) => s.openFilePreview);
  const activeWorkspace = useServerDataStore((s) => s.activeWorkspace);

  const { resolvedMode } = useTheme();
  const isDark = resolvedMode === 'dark';
  const codeTheme = isDark ? CODE_THEME_DARK : CODE_THEME_LIGHT;

  const handlePathClick = () => {
    if (!activeWorkspace) return;
    openFilePreview({
      workspaceId: activeWorkspace.id,
      path,
      name: pathBasename(path),
    });
  };

  const detectedLanguage = language || detectLanguage(path);
  const highlightSet = useMemo(() => new Set(highlightLines), [highlightLines]);
  const lineCount = useMemo(() => content.split('\n').length, [content]);

  const isLargeCode = lineCount > RENDER_BUDGETS.codePlainTextThreshold;

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [content]);

  const previewContent = useMemo(() => {
    if (expanded) return content;
    const lines = content.split('\n', RENDER_BUDGETS.codePreviewLines);
    return lines.join('\n');
  }, [content, expanded]);

  return (
    <div className="visualization-container max-w-full overflow-x-auto border border-border rounded-md">
      <div>
        <div className="group/path flex items-center gap-2 px-1 bg-muted/50 text-xs text-muted-foreground">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-2 px-2 py-1 hover:bg-muted"
          >
            {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          </button>

          <FileText className="size-3" />
          <button
            type="button"
            onClick={handlePathClick}
            className="flex items-center gap-1 font-mono pr-2 hover:text-foreground transition-colors cursor-pointer rounded px-1 py-0.5 -mx-1 hover:bg-muted min-w-0 truncate"
            title={path}
          >
            {path}
            <ExternalLink className="size-2.5 opacity-0 group-hover/path:opacity-100 transition-opacity" />
          </button>

          {!expanded && (
            <span className="text-xs text-muted-foreground/70">
              {lineCount} lines
            </span>
          )}

          <div className="ml-auto mr-2 flex items-center gap-2">
            {isLargeCode && expanded && (
              <span className="text-xs text-muted-foreground/70">
                plain text (large file)
              </span>
            )}
            <button
              type="button"
              onClick={handleCopy}
              className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title="Copy code"
            >
              {copied ? (
                <Check className="size-3 text-success" />
              ) : (
                <Copy className="size-3" />
              )}
            </button>
            {created === false ? (
              <span className="flex items-center gap-1 text-warning">
                <AlertCircle className="size-3" />
                Overwrote
              </span>
            ) : (
              <span className="flex items-center gap-1 text-success">
                <Check className="size-3" />
                Created
              </span>
            )}
          </div>
        </div>

        <div style={{ backgroundColor: codeTheme.plain.backgroundColor }}>
          {isLargeCode && expanded ? (
            previewContent.split('\n').map((line, lineKey) => (
              <div
                key={lineKey}
                className={cn(
                  'flex font-mono text-xs',
                  highlightSet.has(lineKey + 1) && 'bg-warning/20',
                )}
              >
                <span className={cn('w-10 text-right pr-2 select-none border-r', isDark ? 'text-muted-foreground border-white/10' : 'text-muted-foreground border-border')}>
                  {lineKey + 1}
                </span>
                <span className="pl-2 flex-1 whitespace-pre overflow-hidden text-foreground/90">
                  {line}
                </span>
              </div>
            ))
          ) : (
            <Highlight theme={codeTheme} code={previewContent} language={detectedLanguage}>
              {({ tokens, getTokenProps }) => {
                const displayedTokens = expanded ? tokens : tokens.slice(0, RENDER_BUDGETS.codePreviewLines);

                return (
                  <>
                    {displayedTokens.map((line, lineKey) => (
                      <div
                        key={lineKey}
                        className={cn(
                          'flex font-mono text-xs',
                          highlightSet.has(lineKey + 1) && 'bg-warning/20',
                        )}
                      >
                        <span className={cn('w-10 text-right pr-2 select-none border-r', isDark ? 'text-muted-foreground border-white/10' : 'text-muted-foreground border-border')}>
                          {lineKey + 1}
                        </span>
                        <span className="pl-2 flex-1 whitespace-pre overflow-hidden">
                          {line.map((token, tokenKey) => (
                            <span key={tokenKey} {...getTokenProps({ token })} className="token" />
                          ))}
                        </span>
                      </div>
                    ))}
                  </>
                );
              }}
            </Highlight>
          )}
        </div>
      </div>
    </div>
  );
});
