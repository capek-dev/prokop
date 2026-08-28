import { useMemo } from 'react';
import { File as PierreFile } from '@pierre/diffs/react';
import type { FileContents } from '@pierre/diffs/react';
import { useTheme } from '@/components/providers/ThemeProvider';
import { pierreDiffsBaseOptions, resolvePierreLang } from '@/lib/pierreDiffsTheme';

export interface FilePreviewCodeViewProps {
  content: string;
  path: string;
  language?: string;
  showLineNumbers?: boolean;
}

export default function FilePreviewCodeView({
  content,
  path,
  language,
  showLineNumbers = true,
}: FilePreviewCodeViewProps) {
  const { resolvedMode } = useTheme();
  const baseOptions = useMemo(() => pierreDiffsBaseOptions(resolvedMode), [resolvedMode]);
  const options = useMemo(
    () => ({ ...baseOptions, disableLineNumbers: !showLineNumbers }),
    [baseOptions, showLineNumbers],
  );
  const name = path.split('/').pop() ?? path;
  const lang = useMemo(() => resolvePierreLang(name, language), [name, language]);
  const file = useMemo<FileContents>(() => ({ name, contents: content, lang }), [name, content, lang]);

  // Vertical scroll container: Pierre's [data-code] only scrolls x and
  // expects an overflow-y-auto ancestor for wheel/touch scrolling.
  return (
    <div className="h-full w-full overflow-y-auto overflow-x-hidden">
      <PierreFile file={file} options={options} className="min-h-full w-full" />
    </div>
  );
}
