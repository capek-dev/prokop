/**
 * Canonical tool names whose completion may change files on disk.
 *
 * Shared by the server (workspace `files.changed` emission) and the client
 * (part-updated fallback invalidation). Names are the canonical tool names
 * persisted on tool parts: builtin names, plus the Claude/Codex canonicalized
 * forms (`Bash` -> `shell`, `Edit`/`MultiEdit`/`NotebookEdit` -> `edit`,
 * `Write` -> `write-file`, Codex `commandExecution` -> `shell`,
 * `fileChange` -> `edit`). MCP and custom tools are deliberately not
 * classifiable from their names.
 */
export const FILE_MUTATING_TOOL_NAMES = [
  'edit',
  'write-file',
  'shell',
  'terminal',
  'cp',
  'mv',
  'mkdir',
  'touch',
  'ln',
] as const;

const FILE_MUTATING_TOOL_NAME_SET: ReadonlySet<string> = new Set(FILE_MUTATING_TOOL_NAMES);

export function isFileMutatingToolName(name: string): boolean {
  return FILE_MUTATING_TOOL_NAME_SET.has(name);
}
