/**
 * Supported visualization types for tool outputs.
 */
export type VisualizationType = 'diff' | 'diffs' | 'code' | 'table' | 'file-list' | 'markdown' | 'shell-output' | 'none' | 'todo-list' | 'structured-response';

/**
 * Base interface for all visualization types embedded in tool output.
 */
export interface ToolVisualization {
  type: VisualizationType;
  title?: string;
  collapsed?: boolean;
}

/**
 * Visualization for git diff output showing file changes.
 */
export interface DiffVisualization extends ToolVisualization {
  type: 'diff';
  /** The file path that was modified */
  path: string;
  /** Language for syntax highlighting (e.g., 'typescript', 'python') */
  language?: string;
  /** Pre-computed diff hunks with context lines */
  hunks: DiffHunk[];
  /** Count of added lines */
  additions: number;
  /** Count of removed lines */
  deletions: number;
  /** Information about the match strategy used to find the diff location */
  matchInfo?: {
    strategy: string;
    lineNumber: number;
  };
}

/**
 * A contiguous section of changes in a diff.
 */
export interface DiffHunk {
  /** Starting line number in the old file */
  oldStart: number;
  /** Number of lines in the old file for this hunk */
  oldLines: number;
  /** Starting line number in the new file */
  newStart: number;
  /** Number of lines in the new file for this hunk */
  newLines: number;
  /** Individual line changes in this hunk */
  changes: DiffChange[];
}

/**
 * A single line change in a diff hunk.
 */
export interface DiffChange {
  /** Type of change */
  type: 'added' | 'removed' | 'context';
  /** The content of the line */
  content: string;
  /** Line number in the old file (undefined for new lines) */
  oldLineNumber?: number;
  /** Line number in the new file (undefined for removed lines) */
  newLineNumber?: number;
}

/**
 * Visualization for multiple diff outputs (e.g., multiedit tool).
 */
export interface DiffsVisualization extends ToolVisualization {
  type: 'diffs';
  /** Array of diff visualizations */
  items: DiffVisualization[];
}

/**
 * Visualization for displaying full file content.
 */
export interface CodeVisualization extends ToolVisualization {
  type: 'code';
  /** The file path */
  path: string;
  /** Full file content for display */
  content: string;
  /** Language for syntax highlighting */
  language?: string;
  /** Whether the file was newly created (true) or overwrote existing (false) */
  created: boolean;
  /** Specific line numbers to highlight */
  highlightLines?: number[];
  /** Total number of lines in the file */
  lineCount?: number;
}

/**
 * Visualization for displaying a list of files with optional grouping.
 */
export interface FileListVisualization extends ToolVisualization {
  type: 'file-list';
  /** Grouped files with labels and icons */
  groups?: Array<{
    label: string;
    files: FileListItem[];
    icon: 'edit' | 'plus' | 'trash' | 'search';
  }>;
  /** Flat list of files (alternative to groups) */
  files?: FileListItem[];
  /** Total number of files */
  total?: number;
}

/**
 * Individual file item in a file list.
 */
export interface FileListItem {
  /** File path */
  path: string;
  /** Action performed on the file */
  action?: 'created' | 'modified' | 'deleted';
  /** Optional line number reference */
  line?: number;
  /** Optional content preview */
  content?: string;
}

/**
 * Visualization for tabular data display.
 */
export interface TableVisualization extends ToolVisualization {
  type: 'table';
  /** Column definitions */
  columns: TableColumn[];
  /** Row data as key-value records */
  rows: Record<string, unknown>[];
  /** Total number of rows (for pagination) */
  totalRows?: number;
  /** Whether there are more rows beyond current display */
  hasMore?: boolean;
}

/**
 * Column definition for table visualization.
 */
export interface TableColumn {
  /** Key name matching row data */
  key: string;
  /** Display label for the column */
  label?: string;
  /** Optional width specification */
  width?: string;
}

/**
 * Visualization for markdown/rendered content.
 */
export interface MarkdownVisualization extends ToolVisualization {
  type: 'markdown';
  /** Markdown content to render */
  content: string;
  /** Optional source URL for the content */
  sourceUrl?: string;
}

/**
 * Visualization for displaying shell/terminal command output.
 */
export interface ShellOutputVisualization extends ToolVisualization {
  type: 'shell-output';
  /** The command that was executed */
  command: string;
  /** Standard output from the command */
  stdout?: string;
  /** Standard error from the command */
  stderr?: string;
  /** Exit code from the command */
  exitCode: number;
}

/**
 * Visualization indicating no content to display.
 */
export interface NoneVisualization extends ToolVisualization {
  type: 'none';
  /** Optional message explaining why there's no visualization */
  message?: string;
}

/**
 * Visualization for displaying a todo/checklist with status indicators.
 */
export interface TodoListVisualization extends ToolVisualization {
  type: 'todo-list';
  /** List of todo items */
  items: TodoListItem[];
}

/**
 * Individual todo item in a todo list visualization.
 */
export interface TodoListItem {
  /** The task content/description */
  content: string;
  /** Status: pending, in_progress, completed, cancelled */
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  /** Priority: high, medium, low */
  priority: 'high' | 'medium' | 'low';
}

/**
 * Visualization for structured/JSON response output from the LLM.
 * Used when a response format is selected and the model produces
 * a structured object instead of free-form text.
 */
export interface StructuredResponseVisualization extends ToolVisualization {
  type: 'structured-response';
  /** The format name that was used */
  formatName?: string;
  /** The structured data returned by the model */
  data: Record<string, unknown>;
  /** The JSON Schema that was used to constrain the response */
  schema?: Record<string, unknown>;
}

/**
 * Union of all possible visualization types.
 */
export type AnyVisualization =
  | DiffVisualization
  | DiffsVisualization
  | CodeVisualization
  | FileListVisualization
  | TableVisualization
  | MarkdownVisualization
  | ShellOutputVisualization
  | NoneVisualization
  | TodoListVisualization
  | StructuredResponseVisualization;

/**
 * Tool output pattern that includes optional visualization data.
 * The _visualization field is stored in the database but filtered
 * out before passing tool results to the LLM to avoid token bloat.
 */
export interface VisualizableToolOutput {
  success: boolean;
  error?: string;
  /** Visualization data - stripped before LLM consumption */
  _visualization?: AnyVisualization;
}
