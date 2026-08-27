/**
 * Shared rendering budget thresholds for large-content visualizations.
 *
 * These prevent unbounded parsing, tokenizing, and rendering when
 * displaying generated code, diffs, structured responses, file lists,
 * and tool outputs.
 *
 * Tune from Phase 00 measurements. Defaults are conservative.
 */

export const RENDER_BUDGETS = {
  /** Lines of code to highlight in a collapsed preview */
  codePreviewLines: 20,

  /** Lines of code above which expanded mode renders plain text instead of highlighted */
  codePlainTextThreshold: 500,

  /** Diff lines to show in a collapsed preview per file block */
  diffPreviewLines: 30,

  /** Diff lines above which only plain text is used (no syntax highlighting) */
  diffPlainTextThreshold: 300,

  /** Tool output characters before showing a truncated preview */
  toolOutputPreviewChars: 1536,

  /** Maximum nesting depth for structured response rendering before switching to raw JSON */
  structuredMaxDepth: 5,

  /** Maximum array items to render initially in a structured response */
  structuredMaxArrayItems: 50,

  /** Maximum object entries to render initially in a structured response */
  structuredMaxObjectEntries: 30,

  /** Maximum total nodes (across all nesting) before switching to raw JSON */
  structuredMaxNodes: 500,

  /** File list items to render before requiring expansion */
  fileListMaxItems: 200,

  /** File list items rendered inline before collapsing behind a toggle */
  fileListInlineMaxItems: 8,

  /** Todo list items above which virtualization or pagination is considered */
  todoListVirtualizeThreshold: 100,

  /** Visible file-tree nodes above which the flat list is virtualized */
  fileTreeVirtualizeThreshold: 200,

  /** Root sessions fetched per favorited workspace on the overview initial page */
  overviewInitialPageSize: 50,
} as const;
