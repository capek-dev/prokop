import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { PierreCodeEditor } from '@/components/editor/PierreCodeEditor';
import { conflictSections, hasConflictMarkers } from './rebaseConflictSections';

/** Fixed source ranges keep resolved conflicts visible and choices reversible. */
export function RebaseConflictHunks({ draft, disabled, onChange, fileName = 'file.txt', incomingLabel = 'Incoming version', featureLabel = 'Your change' }: {
  draft: string; disabled: boolean; onChange: (text: string) => void; fileName?: string; incomingLabel?: string; featureLabel?: string;
}) {
  const [source] = useState(draft);
  const [selected, setSelected] = useState(0);
  const [replacementVersion, setReplacementVersion] = useState(0);
  const [results, setResults] = useState<Record<number, string>>({});
  const sections = conflictSections(source);
  const section = sections[selected];
  if (!section) return null;
  const windows = sections.map((item, index) => {
    const beforeStart = index ? sections[index - 1].end : 0;
    const afterEnd = sections[index + 1]?.start ?? source.length;
    const before = source.slice(beforeStart, item.start).match(/[^\n]*\n|[^\n]+$/g) ?? [];
    const after = source.slice(item.end, afterEnd).match(/[^\n]*\n|[^\n]+$/g) ?? [];
    // Split shared context so adjacent editable windows never overlap.
    const prefixCount = Math.min(4, index ? Math.floor(before.length / 2) : before.length);
    const prefix = prefixCount ? before.slice(-prefixCount).join('') : '';
    const suffix = after.slice(0, Math.min(4, index < sections.length - 1 ? Math.ceil(after.length / 2) : after.length)).join('');
    return { start: item.start - prefix.length, end: item.end + suffix.length, prefix, suffix };
  });
  const window = windows[selected];
  const unresolved = sections.filter((_, i) => results[i] === undefined || hasConflictMarkers(results[i])).length;
  const update = (text: string, replaceEditor = false) => {
    if (replaceEditor) setReplacementVersion((version) => version + 1);
    const next = { ...results, [selected]: text };
    setResults(next);
    let output = '';
    let cursor = 0;
    for (let i = 0; i < windows.length; i++) {
      output += source.slice(cursor, windows[i].start) + (next[i] ?? source.slice(windows[i].start, windows[i].end));
      cursor = windows[i].end;
    }
    onChange(output + source.slice(cursor));
  };
  const result = results[selected] ?? source.slice(window.start, window.end);
  const range = (text: string) => ({ start: window.prefix.split('\n').length, end: window.prefix.split('\n').length + Math.max(0, text.replace(/\r?\n$/, '').split('\n').length - 1) });
  return <div className="flex min-w-0 flex-col gap-2" aria-label="Conflict sections">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <strong className="text-sm" aria-live="polite">Conflict {selected + 1} of {sections.length} · {unresolved} unresolved</strong>
      <div className="flex gap-1"><Button size="sm" variant="ghost" disabled={selected === 0} onClick={() => setSelected(selected - 1)}>Previous</Button><Button size="sm" variant="ghost" disabled={selected === sections.length - 1} onClick={() => setSelected(selected + 1)}>Next</Button></div>
    </div>
    <p className="text-xs text-muted-foreground">Around line {section.line} in the original working file. Choose a version or edit the result between them.</p>
    <MergePane title={incomingLabel} fileName={fileName} value={window.prefix + section.base + window.suffix} id={`${fileName}:${selected}:base`} selectedLines={section.base ? range(section.base) : undefined} />
    {!section.base && <p className="text-xs text-muted-foreground">Incoming version has no lines in the conflicting range.</p>}
    <Button variant="outline" size="sm" disabled={disabled} onClick={() => update(window.prefix + section.base + window.suffix, true)}>Use incoming version ↓</Button>
    <MergePane title={results[selected] === undefined || hasConflictMarkers(result) ? 'Result · unresolved, editable' : 'Result · resolved, editable'} fileName={fileName} value={result} id={`${fileName}:${selected}:result:${replacementVersion}`} onChange={update} disabled={disabled} selectedLines={results[selected] === undefined ? range(source.slice(section.start, section.end)) : undefined} />
    <Button variant="outline" size="sm" disabled={disabled} onClick={() => update(window.prefix + section.feature + window.suffix, true)}>Use your change ↑</Button>
    <MergePane title={featureLabel} fileName={fileName} value={window.prefix + section.feature + window.suffix} id={`${fileName}:${selected}:feature`} selectedLines={section.feature ? range(section.feature) : undefined} />
    {!section.feature && <p className="text-xs text-muted-foreground">Your change has no lines in the conflicting range.</p>}
    {section.base && section.feature && <Button variant="ghost" size="sm" disabled={disabled} onClick={() => update(window.prefix + section.base + section.feature + window.suffix, true)}>Keep both, incoming first</Button>}
  </div>;
}
export function MergePane({ title, fileName, value, id, onChange, disabled = false, selectedLines }: {
  title: string; fileName: string; value: string; id: string; onChange?: (text: string) => void; disabled?: boolean; selectedLines?: { start: number; end: number };
}) {
  const instanceId = useId();
  return <section className="min-w-0 overflow-hidden rounded-md border" aria-label={title}>
    <h4 className="bg-muted px-2 py-1 text-xs font-medium">{title}</h4>
    <div className="h-48 min-w-0"><PierreCodeEditor key={id} docId={`${instanceId}:${id}`} fileName={fileName} value={value} saving={!onChange || disabled} onChange={onChange ?? (() => {})} showGitDiff={false} selectedLines={selectedLines} /></div>
  </section>;
}
