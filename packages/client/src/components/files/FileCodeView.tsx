import { Highlight, themes } from 'prism-react-renderer';
import { memo, useMemo } from 'react';
import type { GitDiffHunk } from '@prokopai/sdk';
import { cn } from '@/lib/utils';
import { useTheme } from '@/components/providers/ThemeProvider';

const CODE_THEME_DARK = themes.oneDark;
const CODE_THEME_LIGHT = themes.oneLight;

interface VirtualLine {
  type: 'context' | 'added' | 'removed';
  content: string;
  newLineNumber?: number;
}

interface FileCodeViewProps {
  content: string;
  language?: string;
  diff?: {
    hunks: GitDiffHunk[];
    additions: number;
    deletions: number;
  };
}

function buildVirtualLines(
  fileContent: string,
  hunks: GitDiffHunk[],
): VirtualLine[] {
  const fileLines = fileContent.split('\n');
  if (fileLines.length > 0 && fileLines[fileLines.length - 1] === '') {
    fileLines.pop();
  }

  const result: VirtualLine[] = [];
  let cursor = 0;

  for (const hunk of hunks) {
    const hunkStart = hunk.newStart - 1;

    while (cursor < hunkStart && cursor < fileLines.length) {
      result.push({
        type: 'context',
        content: fileLines[cursor],
        newLineNumber: cursor + 1,
      });
      cursor++;
    }

    for (const change of hunk.changes) {
      result.push({
        type: change.type,
        content: change.content,
        newLineNumber: change.type !== 'removed' ? change.newLineNumber : undefined,
      });

      if (change.type !== 'removed') {
        cursor++;
      }
    }
  }

  while (cursor < fileLines.length) {
    result.push({
      type: 'context',
      content: fileLines[cursor],
      newLineNumber: cursor + 1,
    });
    cursor++;
  }

  return result;
}

function DiffLine({
  content,
  type,
  newLineNumber,
  language,
  codeTheme,
  isDark,
}: {
  content: string;
  type: 'context' | 'added' | 'removed';
  newLineNumber?: number;
  language: string;
  codeTheme: typeof CODE_THEME_DARK;
  isDark: boolean;
}) {
  const bgClass = cn(
    type === 'added' && (isDark ? 'bg-green-500/15' : 'bg-green-500/10'),
    type === 'removed' && (isDark ? 'bg-red-500/15' : 'bg-red-500/10'),
  );

  const gutterClass = cn(
    type === 'added' && (isDark ? 'bg-green-500/25 text-green-400' : 'bg-green-500/15 text-green-600'),
    type === 'removed' && (isDark ? 'bg-red-500/25 text-red-400' : 'bg-red-500/15 text-red-600'),
    type === 'context' && 'opacity-50',
  );

  return (
    <div className={cn('table-row', bgClass)}>
      <span
        className={cn(
          'table-cell pr-4 text-right select-none text-xs w-12 border-r',
          isDark ? 'border-white/5' : 'border-border',
          gutterClass,
        )}
      >
        {newLineNumber ?? ''}
      </span>
      <span className="table-cell pl-4 whitespace-pre">
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
}

function FileCodeViewInner({
  content,
  language,
  diff,
}: FileCodeViewProps) {
  const { resolvedMode } = useTheme();
  const isDark = resolvedMode === 'dark';
  const codeTheme = isDark ? CODE_THEME_DARK : CODE_THEME_LIGHT;
  const lang = language || 'plaintext';

  const virtualLines = useMemo(() => {
    if (!diff || diff.hunks.length === 0) return null;
    return buildVirtualLines(content, diff.hunks);
  }, [diff, content]);

  const bgColor = codeTheme.plain.backgroundColor || (isDark ? '#282c34' : '#fafafa');

  if (virtualLines) {
    return (
      <div
        className="h-full overflow-auto chat-transcript-scrollbar"
        style={{ WebkitOverflowScrolling: 'touch', backgroundColor: bgColor }}
      >
        <pre className="text-sm p-4 min-h-full font-mono" style={{ color: codeTheme.plain.color }}>
          {virtualLines.map((line, i) => (
            <DiffLine
              key={i}
              content={line.content}
              type={line.type}
              newLineNumber={line.newLineNumber}
              language={lang}
              codeTheme={codeTheme}
              isDark={isDark}
            />
          ))}
        </pre>
      </div>
    );
  }

  return (
    <div
      className="h-full overflow-auto chat-transcript-scrollbar"
      style={{ WebkitOverflowScrolling: 'touch', backgroundColor: bgColor }}
    >
      <Highlight theme={codeTheme} code={content} language={lang}>
        {({ style, tokens, getLineProps, getTokenProps }) => (
          <pre className="text-sm p-4 min-h-full font-mono" style={style}>
            {tokens.map((line, i) => {
              if (i === tokens.length - 1 && line.length === 1 && line[0].content === '') {
                return null;
              }
              const { className: _lineClass, ...lineRest } = getLineProps({ line });
              return (
                <div key={i} {...lineRest} className="table-row">
                  <span
                    className={cn(
                      'table-cell pr-4 text-right select-none opacity-50 text-xs w-12 border-r',
                      isDark ? 'border-white/5' : 'border-border',
                    )}
                  >
                    {i + 1}
                  </span>
                  <span className="table-cell pl-4">
                    {line.map((token, tokenKey) => (
                      <span key={tokenKey} {...getTokenProps({ token })} />
                    ))}
                  </span>
                </div>
              );
            })}
          </pre>
        )}
      </Highlight>
    </div>
  );
}

export const FileCodeView = memo(FileCodeViewInner);
