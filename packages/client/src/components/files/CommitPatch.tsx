import { useMemo } from 'react';
import { parsePatchFiles, type ThemeTypes } from '@pierre/diffs';
import { FileDiff } from '@pierre/diffs/react';

/** Commit patches contain multiple files; the single-patch renderer does not. */
export function CommitPatch({ patch, themeType }: { patch: string; themeType: ThemeTypes }) {
  const parsed = useMemo(() => {
    try {
      return { files: parsePatchFiles(patch, undefined, true).flatMap((entry) => entry.files), error: null };
    } catch {
      return { files: [], error: 'Unable to render this commit diff.' };
    }
  }, [patch]);
  if (parsed.error) return <p role="alert" className="p-3 text-xs text-destructive">{parsed.error}</p>;
  return <>{parsed.files.map((file, index) => <FileDiff key={`${index}:${file.name}`} fileDiff={file} options={{ diffStyle: 'unified', themeType }} />)}</>;
}
