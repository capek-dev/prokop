export interface ConflictSection {
  start: number;
  end: number;
  line: number;
  baseLine: number;
  featureLine: number;
  base: string;
  feature: string;
}

/** Preserve offsets and line endings, including custom marker sizes and diff3 ancestors. */
export function conflictSections(text: string): ConflictSection[] {
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) { offsets.push(offset); offset += line.length; }
  const sections: ConflictSection[] = [];
  for (let i = 0; i < lines.length; i++) {
    const opening = /^(<{7,})(?: |\r?$)/.exec(lines[i].replace(/\n$/, ''));
    if (!opening) continue;
    const width = opening[1].length;
    const marker = (line: string, char: string) => new RegExp(`^${char}{${width}}(?: |\\r?$)`).test(line.replace(/\n$/, ''));
    let ancestor = -1;
    let divider = -1;
    let end = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (marker(lines[j], '<')) break;
      if (marker(lines[j], '\\|') && divider < 0) ancestor = j;
      if (marker(lines[j], '=') && divider < 0) divider = j;
      if (marker(lines[j], '>')) { end = j; break; }
    }
    if (divider < 0 || end < divider) continue;
    sections.push({ start: offsets[i], end: offsets[end] + lines[end].length, line: i + 1, baseLine: i + 2, featureLine: divider + 2,
      base: lines.slice(i + 1, ancestor < 0 ? divider : ancestor).join(''), feature: lines.slice(divider + 1, end).join('') });
    i = end;
  }
  return sections;
}
export function hasConflictMarkers(text: string): boolean {
  return /^(?:<{7,}|>{7,}|\|{7,})(?: |\r?$)|^={7,}\r?$/m.test(text);
}
