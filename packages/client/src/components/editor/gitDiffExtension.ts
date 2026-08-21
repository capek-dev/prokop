import {
  StateEffect,
  StateField,
  RangeSetBuilder,
  type Extension,
} from '@codemirror/state';
import type { EditorState } from '@codemirror/state';
import {
  EditorView,
  Decoration,
  gutter,
  GutterMarker,
  WidgetType,
  type DecorationSet,
} from '@codemirror/view';
import type { GitDiffHunk } from '@prokopai/sdk';

// --- Public Types ---

export interface EditorGitDiff {
  hunks: GitDiffHunk[];
  additions: number;
  deletions: number;
}

export interface GitDiffExtensionController {
  extension: Extension;
  setDiff: (view: EditorView, diff: EditorGitDiff | null) => void;
}

// Cap for removed-line block widgets to protect performance on large diffs.
const MAX_REMOVED_BLOCKS = 500;

// --- StateEffect ---

const setDiffEffect = StateEffect.define<EditorGitDiff | null>();

// --- Gutter Markers ---

class AddedGutterMarker extends GutterMarker {
  override elementClass = 'cm-git-added-gutter';
}
class ModifiedGutterMarker extends GutterMarker {
  override elementClass = 'cm-git-modified-gutter';
}
class DeletedGutterMarker extends GutterMarker {
  override elementClass = 'cm-git-deleted-gutter';
}

const markerAdded = new AddedGutterMarker();
const markerModified = new ModifiedGutterMarker();
const markerDeleted = new DeletedGutterMarker();

// --- Widget for removed lines ---

class RemovedLinesWidget extends WidgetType {
  constructor(readonly lines: string[], readonly id: string) {
    super();
  }

  override eq(other: RemovedLinesWidget): boolean {
    return other.id === this.id;
  }

  override toDOM(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'cm-git-removed-widget';
    container.setAttribute('aria-hidden', 'true');

    for (const line of this.lines) {
      const lineEl = document.createElement('div');
      lineEl.className = 'cm-git-removed-line';
      lineEl.textContent = line;
      container.appendChild(lineEl);
    }

    return container;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

// --- Line decorations ---

const addedLineDeco = Decoration.line({ class: 'cm-git-added-line' });
const modifiedLineDeco = Decoration.line({ class: 'cm-git-modified-line' });

// --- Parsed diff types ---

export interface LineEntry {
  /** 0-based editor line number */
  line: number;
  kind: 'added' | 'modified';
}

export interface RemovedBlock {
  /** 0-based editor line number to anchor the widget before */
  anchorLine: number;
  lines: string[];
  /** Stable identity for widget equality */
  id: string;
}

export interface GutterEntry {
  /** 0-based editor line number */
  line: number;
  kind: 'added' | 'modified' | 'deleted';
}

export interface ParsedDiff {
  lineEntries: LineEntry[];
  removedBlocks: RemovedBlock[];
  gutterEntries: GutterEntry[];
  removedContentTruncated: boolean;
}

/**
 * Parse git diff hunks into editor decorations.
 *
 * Hunks use 1-based line numbers. `newStart`/`newLines` describe the
 * current file lines. We walk through each hunk's changes, tracking the
 * current new-line number. Additions directly following a removed group are
 * classified as modified. Removed lines collect into blocks anchored at the
 * nearest surviving line.
 */
export function parseGitDiffHunks(hunks: GitDiffHunk[]): ParsedDiff {
  const lineEntries: LineEntry[] = [];
  const removedBlocks: RemovedBlock[] = [];
  const gutterEntries: GutterEntry[] = [];
  let removedBlockSequence = 0;
  let removedContentTruncated = false;

  for (const [hunkIndex, hunk] of hunks.entries()) {
    let newLine = hunk.newStart;
    let pendingRemoved: string[] = [];
    let isModifiedAdditionGroup = false;

    const flushRemoved = () => {
      if (pendingRemoved.length === 0) return;

      const anchorLine = Math.max(0, newLine - 1);
      gutterEntries.push({ line: anchorLine, kind: 'deleted' });

      if (removedBlocks.length < MAX_REMOVED_BLOCKS) {
        removedBlocks.push({
          anchorLine,
          lines: pendingRemoved,
          id: `r-${hunkIndex}-${removedBlockSequence}`,
        });
      } else {
        removedContentTruncated = true;
      }

      removedBlockSequence++;
      pendingRemoved = [];
    };

    for (const change of hunk.changes) {
      if (change.type === 'removed') {
        isModifiedAdditionGroup = false;
        pendingRemoved.push(change.content);
        continue;
      }

      if (change.type === 'context') {
        flushRemoved();
        isModifiedAdditionGroup = false;
        newLine++;
        continue;
      }

      if (pendingRemoved.length > 0) {
        flushRemoved();
        isModifiedAdditionGroup = true;
      }

      const line = Math.max(0, newLine - 1);
      const kind = isModifiedAdditionGroup ? 'modified' : 'added';
      lineEntries.push({ line, kind });
      gutterEntries.push({ line, kind });
      newLine++;
    }

    flushRemoved();
  }

  return {
    lineEntries,
    removedBlocks,
    gutterEntries,
    removedContentTruncated,
  };
}

export function isGitDiffRemovedContentTruncated(hunks: GitDiffHunk[]): boolean {
  let removedBlocks = 0;

  for (const hunk of hunks) {
    let inRemovedBlock = false;
    for (const change of hunk.changes) {
      if (change.type === 'removed') {
        if (!inRemovedBlock) {
          removedBlocks++;
          if (removedBlocks > MAX_REMOVED_BLOCKS) return true;
        }
        inRemovedBlock = true;
      } else {
        inRemovedBlock = false;
      }
    }
  }

  return false;
}

/**
 * Build a DecorationSet from parsed line entries and removed blocks
 * against the given editor state.
 */
function buildDecorationSet(
  state: EditorState,
  lineEntries: LineEntry[],
  removedBlocks: RemovedBlock[],
): DecorationSet {
  const totalLines = state.doc.lines;
  const ranges: { from: number; to: number; value: Decoration }[] = [];

  for (const entry of lineEntries) {
    const lineNum = Math.min(entry.line + 1, totalLines);
    if (lineNum < 1) continue;
    const lineObj = state.doc.line(lineNum);
    ranges.push({
      from: lineObj.from,
      to: lineObj.from,
      value: entry.kind === 'added' ? addedLineDeco : modifiedLineDeco,
    });
  }

  for (const block of removedBlocks) {
    const anchorLine1 = Math.min(block.anchorLine + 1, totalLines);
    if (anchorLine1 < 1) continue;
    const lineObj = state.doc.line(anchorLine1);
    ranges.push({
      from: lineObj.from,
      to: lineObj.from,
      value: Decoration.widget({
        widget: new RemovedLinesWidget(block.lines, block.id),
        side: -1,
        block: true,
      }),
    });
  }

  return Decoration.set(
    ranges.map((range) => range.value.range(range.from, range.to)),
    true,
  );
}

/**
 * Build a RangeSet<GutterMarker> from parsed gutter entries.
 */
function buildGutterSet(
  state: EditorState,
  gutterEntries: GutterEntry[],
): import('@codemirror/state').RangeSet<GutterMarker> {
  const builder = new RangeSetBuilder<GutterMarker>();
  const totalLines = state.doc.lines;
  const entries: { from: number; to: number; marker: GutterMarker }[] = [];
  const precedence: Record<GutterEntry['kind'], number> = {
    added: 1,
    deleted: 2,
    modified: 3,
  };
  const entriesByLine = new Map<number, GutterEntry>();

  for (const entry of gutterEntries) {
    const lineNum = Math.min(entry.line + 1, totalLines);
    if (lineNum < 1) continue;
    const existing = entriesByLine.get(lineNum);
    if (!existing || precedence[entry.kind] > precedence[existing.kind]) {
      entriesByLine.set(lineNum, entry);
    }
  }

  for (const [lineNum, entry] of entriesByLine) {
    const lineObj = state.doc.line(lineNum);
    const marker = entry.kind === 'added' ? markerAdded : entry.kind === 'modified' ? markerModified : markerDeleted;
    entries.push({ from: lineObj.from, to: lineObj.from, marker });
  }

  entries.sort((a, b) => a.from - b.from);

  for (const e of entries) {
    builder.add(e.from, e.to, e.marker);
  }

  return builder.finish();
}

// --- StateField ---

interface DiffState {
  decorations: DecorationSet;
  gutterMarkers: import('@codemirror/state').RangeSet<GutterMarker>;
  hasData: boolean;
}

const emptyGutterSet = new RangeSetBuilder<GutterMarker>().finish();

const emptyState: DiffState = {
  decorations: Decoration.none,
  gutterMarkers: emptyGutterSet,
  hasData: false,
};

const diffField = StateField.define<DiffState>({
  create: () => emptyState,

  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setDiffEffect)) {
        const diff = effect.value;
        if (!diff || diff.hunks.length === 0) {
          return emptyState;
        }
        const parsed = parseGitDiffHunks(diff.hunks);
        return {
          decorations: buildDecorationSet(transaction.startState, parsed.lineEntries, parsed.removedBlocks),
          gutterMarkers: buildGutterSet(transaction.startState, parsed.gutterEntries),
          hasData: true,
        };
      }
    }

    // Map decorations and gutter markers through document changes.
    if (transaction.docChanged) {
      return {
        decorations: value.decorations.map(transaction.changes),
        gutterMarkers: value.gutterMarkers.map(transaction.changes),
        hasData: value.hasData,
      };
    }

    return value;
  },

  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.decorations),
    gutter({
      class: 'cm-git-diff-gutter',
      markers: (view) => view.state.field(field).gutterMarkers,
    }),
  ],
});

// --- Public API ---

/**
 * Create a CodeMirror extension that renders Git diff decorations.
 *
 * The extension provides:
 * - line background colors for added and modified lines,
 * - gutter markers for added, modified, and deleted lines,
 * - block widgets showing removed line content,
 * - automatic position mapping through editor transactions.
 *
 * The caller loads diff data and calls `controller.setDiff(view, data)`
 * whenever the authoritative diff changes.
 */
export function createGitDiffExtension(): GitDiffExtensionController {
  return {
    extension: diffField,
    setDiff: (view, diff) => {
      view.dispatch({ effects: setDiffEffect.of(diff) });
    },
  };
}
