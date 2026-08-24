import { ChevronDown, ChevronRight, ExternalLink, FileText } from 'lucide-react';
import { memo, useState, useMemo } from 'react';
import { Highlight, themes } from 'prism-react-renderer';

const CODE_THEME_DARK = themes.oneDark;
const CODE_THEME_LIGHT = themes.oneLight;
import type { DiffHunk } from '@/utils/diff';
import { cn } from '@/lib/utils';
import { pathBasename } from '@/lib/platform';
import { useUIStore } from '@/stores/uiStore';
import { useServerDataStore } from '@/stores/serverDataStore';
import { useTheme } from '@/components/providers/ThemeProvider';
import { RENDER_BUDGETS } from '@/lib/renderBudgets';

interface DiffViewerProps {
  hunks: DiffHunk[];
  path: string;
  language?: string;
  additions?: number;
  deletions?: number;
  disablePathOpen?: boolean;
  matchInfo?: {
    strategy: string;
    lineNumber: number;
  };
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

interface DiffLineProps {
  type: 'added' | 'removed' | 'context';
  content: string;
  lineNumber?: number;
  newLineNumber?: number;
  language: string;
  codeTheme: typeof CODE_THEME_DARK;
  isDark: boolean;
}

const DiffLine = memo(function DiffLine({ type, content, lineNumber, newLineNumber, language, codeTheme }: DiffLineProps) {
  const tintClass = cn(
    'flex font-mono text-xs',
    type === 'added' && 'bg-green-500/15',
    type === 'removed' && 'bg-red-500/15',
    type === 'context' && 'bg-muted/30',
  );

  const prefixColor = cn(
    'font-bold w-4 select-none',
    type === 'added' && 'text-green-600 dark:text-green-400',
    type === 'removed' && 'text-red-600 dark:text-red-400',
    type === 'context' && 'text-muted-foreground/50',
  );

  return (
    <div className={tintClass}>
      <span className={cn('w-10 text-right pr-2 text-muted-foreground select-none border-r border-border')}>
        {lineNumber ?? ''}
      </span>
      <span className={cn('w-10 text-right pr-2 text-muted-foreground select-none border-r border-border')}>
        {newLineNumber ?? ''}
      </span>
      <span className="pl-2 flex-1 whitespace-pre overflow-hidden flex">
        <span className={prefixColor}>
          {type === 'added' && '+'}
          {type === 'removed' && '-'}
          {type === 'context' && ' '}
        </span>
        <Highlight theme={codeTheme} code={content} language={language}>
          {({ tokens, getTokenProps }) => (
            <>
              {tokens.map((line, lineKey) => (
                <span key={lineKey}>
                  {line.map((token, tokenKey) => (
                    <span key={tokenKey} {...getTokenProps({ token })} />
                  ))}
                </span>
              ))}
            </>
          )}
        </Highlight>
      </span>
    </div>
  );
});

interface PlainDiffLineProps {
  type: 'added' | 'removed' | 'context';
  content: string;
  lineNumber?: number;
  newLineNumber?: number;
}

const PlainDiffLine = memo(function PlainDiffLine({ type, content, lineNumber, newLineNumber }: PlainDiffLineProps) {
  const tintClass = cn(
    'flex font-mono text-xs',
    type === 'added' && 'bg-green-500/15',
    type === 'removed' && 'bg-red-500/15',
    type === 'context' && 'bg-muted/30',
  );

  const prefixColor = cn(
    'font-bold w-4 select-none',
    type === 'added' && 'text-green-600 dark:text-green-400',
    type === 'removed' && 'text-red-600 dark:text-red-400',
    type === 'context' && 'text-muted-foreground/50',
  );

  return (
    <div className={tintClass}>
      <span className={cn('w-10 text-right pr-2 text-muted-foreground select-none border-r border-border')}>
        {lineNumber ?? ''}
      </span>
      <span className={cn('w-10 text-right pr-2 text-muted-foreground select-none border-r border-border')}>
        {newLineNumber ?? ''}
      </span>
      <span className="pl-2 flex-1 whitespace-pre overflow-hidden flex">
        <span className={prefixColor}>
          {type === 'added' && '+'}
          {type === 'removed' && '-'}
          {type === 'context' && ' '}
        </span>
        <span className="text-foreground/90">{content}</span>
      </span>
    </div>
  );
});

export const DiffViewer = memo(function DiffViewer({ hunks, path, language: propLanguage, additions, deletions, disablePathOpen }: DiffViewerProps) {
  const [expanded, setExpanded] = useState(true);
  const language = propLanguage || detectLanguage(path);

  const openFilePreview = useUIStore((s) => s.openFilePreview);
  const activeWorkspace = useServerDataStore((s) => s.activeWorkspace);

  const { resolvedMode } = useTheme();
  const isDark = resolvedMode === 'dark';
  const codeTheme = isDark ? CODE_THEME_DARK : CODE_THEME_LIGHT;

  const totalDiffLines = useMemo(
    () => hunks.reduce((sum, hunk) => sum + hunk.changes.length, 0),
    [hunks],
  );

  const usePlainText = totalDiffLines > RENDER_BUDGETS.diffPlainTextThreshold;

  const previewHunks = useMemo(() => {
    if (expanded) return hunks;
    let remaining: number = RENDER_BUDGETS.diffPreviewLines;
    const result: DiffHunk[] = [];
    for (const hunk of hunks) {
      if (remaining <= 0) break;
      if (hunk.changes.length <= remaining) {
        result.push(hunk);
        remaining -= hunk.changes.length;
      } else {
        result.push({ ...hunk, changes: hunk.changes.slice(0, remaining) });
        remaining = 0;
      }
    }
    return result;
  }, [hunks, expanded]);

  const handlePathClick = () => {
    if (!activeWorkspace) return;
    openFilePreview({
      workspaceId: activeWorkspace.id,
      path,
      name: pathBasename(path),
    });
  };

  return (
    <div className="visualization-container max-w-full overflow-x-auto border border-border rounded-md">
      <div>
        <div className="group/path flex items-center gap-2 px-1 bg-muted/50 text-xs text-muted-foreground">
          <button
            onClick={() => setExpanded(!expanded)}
            className="px-1 py-1 hover:bg-muted rounded"
          >
            {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          </button>

          <FileText className="size-3" />
          {disablePathOpen ? (
            <span
              className="flex items-center gap-1 font-mono pr-2 px-1 py-0.5 min-w-0 truncate"
              title={path}
            >
              {path}
            </span>
          ) : (
            <button
              type="button"
              onClick={handlePathClick}
              className="flex items-center gap-1 font-mono pr-2 hover:text-foreground transition-colors cursor-pointer rounded px-1 py-0.5 -mx-1 hover:bg-muted min-w-0 truncate"
              title={path}
            >
              {path}
              <ExternalLink className="size-2.5 opacity-0 group-hover/path:opacity-100 transition-opacity" />
            </button>
          )}

          <div className="ml-auto mr-2 flex items-center gap-2">
            {usePlainText && (
              <span className="text-xs text-muted-foreground/70">plain text</span>
            )}
            {!expanded && totalDiffLines > RENDER_BUDGETS.diffPreviewLines && (
              <span className="text-xs text-muted-foreground/70">
                {totalDiffLines} lines
              </span>
            )}
            {additions !== undefined && deletions !== undefined && (
              <span className="text-muted-foreground">
                +{additions} -{deletions}
              </span>
            )}
          </div>
        </div>

        {expanded && (
          <div style={{ backgroundColor: codeTheme.plain.backgroundColor || (isDark ? '#282c34' : '#fafafa') }}>
            {previewHunks.map((hunk, hunkIndex) => (
              <div key={hunkIndex} className={cn('divide-y divide-border')}>
                {hunk.changes.map((change, i) => (
                  usePlainText ? (
                    <PlainDiffLine key={i} {...change} />
                  ) : (
                    <DiffLine key={i} {...change} language={language} codeTheme={codeTheme} isDark={isDark} />
                  )
                ))}
              </div>
            ))}
            {!expanded && totalDiffLines > RENDER_BUDGETS.diffPreviewLines && (
              <div className="text-center py-1 text-xs text-muted-foreground bg-muted/30">
                {totalDiffLines - RENDER_BUDGETS.diffPreviewLines} more lines hidden
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
});
