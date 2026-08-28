import { memo, useMemo } from 'react';
import { File as PierreFile, MultiFileDiff } from '@pierre/diffs/react';
import type { FileContents } from '@pierre/diffs/react';
import type { GitDiffHunk } from '@prokopai/sdk';
import { useTheme } from '@/components/providers/ThemeProvider';
import { headFromHunks } from '@/lib/gitHeadReconstruct';
import { pierreDiffsBaseOptions, resolvePierreLang } from '@/lib/pierreDiffsTheme';

interface FileCodeViewProps {
  content: string;
  language?: string;
  /** Basename used for language inference; optional for callers without one. */
  name?: string;
  diff?: {
    hunks: GitDiffHunk[];
    additions: number;
    deletions: number;
  };
}

function FileCodeViewInner({ content, language, name, diff }: FileCodeViewProps) {
  const { resolvedMode } = useTheme();
  const baseOptions = useMemo(() => pierreDiffsBaseOptions(resolvedMode), [resolvedMode]);
  const diffOptions = useMemo(
    () => ({ ...baseOptions, diffStyle: 'unified' as const }),
    [baseOptions],
  );
  const fileName = name ?? '';
  const lang = useMemo(() => resolvePierreLang(fileName, language), [fileName, language]);

  const head = useMemo(() => {
    if (!diff || diff.hunks.length === 0) return null;
    return headFromHunks(content, diff.hunks);
  }, [content, diff]);

  const newFile = useMemo<FileContents>(
    () => ({ name: fileName, contents: content, lang }),
    [content, fileName, lang],
  );

  if (head === null || !diff) {
    return (
      // Vertical scroll container: Pierre's [data-code] only scrolls x and
      // expects an overflow-y-auto ancestor for wheel/touch scrolling.
      <div className="h-full w-full overflow-y-auto overflow-x-hidden">
        <PierreFile file={newFile} options={baseOptions} className="min-h-full w-full" />
      </div>
    );
  }

  const oldFileContents: FileContents = { name: fileName, contents: head, lang };

  // Deleted-file preview: empty working copy with all-removal hunks renders
  // only the old side (newFile: null).
  const isPureDeletion =
    content === '' &&
    diff.hunks.length > 0 &&
    diff.hunks.every((hunk) => hunk.changes.every((change) => change.type === 'removed'));

  const diffInput = isPureDeletion
    ? { oldFile: oldFileContents, newFile: null }
    : { oldFile: oldFileContents, newFile };

  return (
    <div className="h-full w-full overflow-y-auto overflow-x-hidden">
      <MultiFileDiff {...diffInput} options={diffOptions} className="min-h-full w-full" />
    </div>
  );
}

export const FileCodeView = memo(FileCodeViewInner);
