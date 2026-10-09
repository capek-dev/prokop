import { useMemo } from 'react';
import { parsePatchFiles, type ThemeTypes } from '@pierre/diffs';
import { FileDiff } from '@pierre/diffs/react';
import { PIERRE_THEME_PAIR } from '@/lib/pierreDiffsTheme';
import { pierreCacheKey } from '@/lib/pierreCacheKey';

/** Commit patches contain multiple files; the single-patch renderer does not. */
export function CommitPatch({ patch, themeType }: { patch: string; themeType: ThemeTypes }) {
  const parsed = useMemo(() => {
    try {
      return { files: parsePatchFiles(patch, pierreCacheKey('commit', patch), true).flatMap((entry) => entry.files), error: null };
    } catch {
      return { files: [], error: 'Unable to render this commit diff.' };
    }
  }, [patch]);
  if (parsed.error) return <p role="alert" className="p-3 text-xs text-destructive">{parsed.error}</p>;
  return <>{parsed.files.map((file, index) => <FileDiff key={`${index}:${file.name}`} fileDiff={file} options={{ diffStyle: 'unified', theme: PIERRE_THEME_PAIR, themeType }} />)}</>;
}
