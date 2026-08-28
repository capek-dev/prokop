import { useCallback, useEffect, useMemo, useRef } from 'react';
import { EditProvider, File as PierreFile, MultiFileDiff } from '@pierre/diffs/react';
import type { FileContents } from '@pierre/diffs/react';
import { Editor } from '@pierre/diffs/edit';
import type { EditorOptions } from '@pierre/diffs/edit';
import type { GitDiffHunk } from '@prokopai/sdk';
import { useTheme } from '@/components/providers/ThemeProvider';
import { cn } from '@/lib/utils';
import { headFromHunks } from '@/lib/gitHeadReconstruct';
import { pierreDiffsBaseOptions } from '@/lib/pierreDiffsTheme';

export interface PierreEditorGitDiff {
  hunks: GitDiffHunk[];
  additions: number;
  deletions: number;
}

interface PierreCodeEditorProps {
  /** Document identity string; used as the persistState cacheKey. */
  docId: string;
  /** Basename with extension; drives Pierre's language inference. */
  fileName: string;
  value: string;
  gitDiff?: PierreEditorGitDiff | null;
  showGitDiff?: boolean;
  /** When true the surface is briefly view-only (Pierre has no readOnly). */
  saving?: boolean;
  onChange: (value: string) => void;
  className?: string;
}

const HOST_FONT_STYLE = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '13px',
} as const;

export function PierreCodeEditor({
  docId,
  fileName,
  value,
  gitDiff = null,
  showGitDiff = true,
  saving = false,
  onChange,
  className,
}: PierreCodeEditorProps) {
  const { resolvedMode } = useTheme();

  // Refs are only read inside callbacks/effects (React Compiler-safe).
  const onChangeRef = useRef(onChange);
  const lastEmittedRef = useRef(value);
  const diffWarnedDocIdsRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Stable per-surface editor factory: the EditProvider calls this with
  // per-surface EditorOptions; shared defaults (persistState + onChange
  // bridge) are merged here.
  const createEditor = useCallback((options: EditorOptions<undefined>) => {
    return new Editor<undefined>({
      ...options,
      persistState: true,
      onChange: (file) => {
        const contents = file.contents;
        // Echo guard: never re-emit content the editor already produced.
        if (contents === lastEmittedRef.current) return;
        lastEmittedRef.current = contents;
        onChangeRef.current(contents);
      },
    });
  }, []);

  const baseOptions = useMemo(() => pierreDiffsBaseOptions(resolvedMode), [resolvedMode]);
  const fileOptions = useMemo(
    () => ({ ...baseOptions, stickyHeader: false as const }),
    [baseOptions],
  );
  const diffOptions = useMemo(
    () => ({ ...baseOptions, stickyHeader: false as const, diffStyle: 'unified' as const }),
    [baseOptions],
  );

  // A fresh file object only when content (or identity) actually changes; the
  // File instance re-renders on a new object via its layout effect, which is
  // how external reloads/conflict resolutions push content in.
  const file = useMemo<FileContents>(
    () => ({ name: fileName, contents: value, cacheKey: docId }),
    [docId, fileName, value],
  );

  const diffMode = gitDiff !== null && gitDiff.hunks.length > 0 && showGitDiff;

  const head = useMemo(() => {
    if (!diffMode || gitDiff === null) return null;
    return headFromHunks(value, gitDiff.hunks);
  }, [diffMode, gitDiff, value]);

  // Warn once per docId when reconstruction fails; the surface falls back to
  // a plain file render (fail closed, never render a wrong diff).
  useEffect(() => {
    if (!diffMode || head !== null) return;
    const warned = diffWarnedDocIdsRef.current;
    if (warned === null) {
      diffWarnedDocIdsRef.current = new Set([docId]);
    } else if (warned.has(docId)) {
      return;
    } else {
      warned.add(docId);
    }
    console.warn(
      `[PierreCodeEditor] Git diff reconstruction failed for ${docId}; falling back to plain file view.`,
    );
  }, [diffMode, head, docId]);

  return (
    <EditProvider createEditor={createEditor}>
      {/* The vertical scroll container. Pierre's [data-code] scrolls x only
          (overflow: scroll clip) and expects an ancestor to scroll y; the
          editor's viewport lookup only accepts overflow-y auto/scroll/overlay,
          so this wrapper is what wheel, touch, and scroll restoration use. */}
      <div
        className={cn(
          'pierre-diffs-host h-full w-full overflow-y-auto overflow-x-hidden',
          className,
        )}
        style={HOST_FONT_STYLE}
      >
        {diffMode && head !== null ? (
          <MultiFileDiff
            oldFile={{ name: fileName, contents: head, cacheKey: `${docId}:head` }}
            newFile={file}
            options={diffOptions}
            edit={!saving}
            className="min-h-full w-full"
          />
        ) : (
          <PierreFile file={file} options={fileOptions} edit={!saving} className="min-h-full w-full" />
        )}
      </div>
    </EditProvider>
  );
}
