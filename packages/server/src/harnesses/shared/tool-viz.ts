import type { AnyVisualization, DiffVisualization } from '@prokopai/sdk';

/**
 * Shared harness tool-call naming and visualization.
 *
 * Hybrid scheme: a native tool with a prokop-builtin equivalent stores the
 * canonical name so rows read identically across harnesses and pick up the
 * client display catalog; everything else stores the native name verbatim,
 * unprefixed, so unknown and future tools render honestly without map
 * upkeep. Foreign MCP tools read `server: tool`. Prokop's own MCP tools
 * (Claude) store their bare domain names, matching Codex dynamic tools.
 */

export const PROKOP_MCP_SERVER = 'prokop';

const PROKOP_MCP_TOOLS = new Set(['memory', 'agent_memory', 'session_search', 'agent_skill_manage']);

/** Canonical names for native tools that have a prokop-builtin equivalent. */
const CLAUDE_CANONICAL_NAMES: Record<string, string> = {
  Bash: 'shell',
  Edit: 'edit',
  MultiEdit: 'edit',
  NotebookEdit: 'edit',
  Write: 'write-file',
  Read: 'read-file',
  Glob: 'glob',
  Grep: 'grep',
  WebFetch: 'webfetch',
  WebSearch: 'web-search',
  TodoWrite: 'todo',
  Agent: 'subagent',
};

export function claudeToolName(native: string): string {
  const canonical = CLAUDE_CANONICAL_NAMES[native];
  if (canonical) return canonical;
  if (native.startsWith(`mcp__${PROKOP_MCP_SERVER}__`)) {
    const tool = native.slice(`mcp__${PROKOP_MCP_SERVER}__`.length);
    return PROKOP_MCP_TOOLS.has(tool) ? tool : `${PROKOP_MCP_SERVER}: ${tool}`;
  }
  if (native.startsWith('mcp__')) {
    // mcp__<server>__<tool...> -> `server: tool`
    const rest = native.slice('mcp__'.length);
    const separator = rest.indexOf('__');
    if (separator > 0) return `${rest.slice(0, separator)}: ${rest.slice(separator + 2)}`;
  }
  return native;
}

const MAX_PREVIEW = 8_000;

export function preview(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return text.length > MAX_PREVIEW ? `${text.slice(0, MAX_PREVIEW)}\n[truncated]` : text;
}

/** Input keys whose full text is needed to synthesize visualizations. */
const VIZ_INPUT_KEYS = new Set(['command', 'content', 'old_string', 'new_string']);
const MAX_VIZ_INPUT = 50_000;

/** Length-caps a Claude tool input for the transcript; viz-critical string
 * fields keep far more text so diffs and code views survive. */
export function claudeToolInput(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).slice(0, 16).map(([key, value]) => [key.slice(0, 80),
    typeof value === 'string' ? value.slice(0, VIZ_INPUT_KEYS.has(key) ? MAX_VIZ_INPUT : 1000)
      : typeof value === 'number' || typeof value === 'boolean' ? value : '[omitted]']));
}

function firstString(input: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

/** Server-baked summary per canonical name; native name as the fallback. */
export function claudeToolSummary(name: string, input: Record<string, unknown>): string {
  const summary = (() => {
    switch (name) {
      case 'shell': return firstString(input, ['command', 'description']);
      case 'edit': case 'write-file': case 'read-file':
        return firstString(input, ['file_path', 'notebook_path']);
      case 'glob': case 'grep': return firstString(input, ['pattern', 'path']);
      case 'webfetch': return firstString(input, ['url']);
      case 'web-search': return firstString(input, ['query']);
      case 'todo': return firstString(input, ['todos']) ? 'Update todos' : null;
      case 'subagent': return firstString(input, ['description', 'subagent_type']);
      case 'memory': case 'agent_memory':
        return [input.action, input.target].filter(value => typeof value === 'string').join(' ');
      case 'session_search': return [input.action, input.query].filter(value => typeof value === 'string').join(' ');
      case 'agent_skill_manage': return [input.action, input.name].filter(value => typeof value === 'string').join(' ');
      default: return null;
    }
  })();
  return (summary?.trim() || name).slice(0, 200);
}

// ── Diff synthesis (Claude Edit carries old/new strings, not patches) ──────

interface EditPair { oldString: string; newString: string }

function editHunk({ oldString, newString }: EditPair): DiffVisualization['hunks'][number] {
  const oldLines = oldString ? oldString.split('\n') : [];
  const newLines = newString ? newString.split('\n') : [];
  const changes: DiffVisualization['hunks'][number]['changes'] = [];
  oldLines.forEach((content, index) => changes.push({ type: 'removed', content, oldLineNumber: index + 1 }));
  newLines.forEach((content, index) => changes.push({ type: 'added', content, newLineNumber: index + 1 }));
  return { oldStart: 1, oldLines: oldLines.length, newStart: 1, newLines: newLines.length, changes };
}

/** A single diff per edit pair (no context lines: Claude gives none). */
export function editDiffVisualization(filePath: string, edits: EditPair[]): AnyVisualization {
  const hunks: DiffVisualization['hunks'] = [];
  let additions = 0;
  let deletions = 0;
  for (const edit of edits.slice(0, 50)) {
    const hunk = editHunk(edit);
    additions += hunk.changes.filter(change => change.type === 'added').length;
    deletions += hunk.changes.filter(change => change.type === 'removed').length;
    hunks.push(hunk);
  }
  return { type: 'diff', path: filePath || 'File', hunks, additions, deletions };
}

function claudeEditPairs(input: Record<string, unknown>): { filePath: string; edits: EditPair[] } | null {
  const filePath = typeof input.file_path === 'string' ? input.file_path : '';
  const pair = (value: unknown): EditPair | null =>
    value && typeof value === 'object' && (typeof (value as Record<string, unknown>).old_string === 'string'
      || typeof (value as Record<string, unknown>).new_string === 'string')
      ? {
        oldString: (value as Record<string, unknown>).old_string as string ?? '',
        newString: (value as Record<string, unknown>).new_string as string ?? '',
      }
      : null;
  if (Array.isArray(input.edits)) {
    const edits = input.edits.map(pair).filter((edit): edit is EditPair => edit !== null);
    return edits.length ? { filePath, edits } : null;
  }
  const single = pair(input);
  return single ? { filePath, edits: [single] } : null;
}

// ── Line-based file lists (glob, grep, web search) ─────────────────────────

function fileListFromLines(output: string, singular: string): AnyVisualization {
  const lines = output.split('\n').map(line => line.trim()).filter(Boolean).slice(0, 200);
  const label = singular;
  return {
    type: 'file-list',
    badge: `${lines.length} ${label}${lines.length === 1 ? '' : `${label === 'match' ? 'e' : ''}s`}`,
    singularLabel: label,
    pluralLabel: `${label}s`,
    files: lines.map(line => ({ path: line.slice(0, 500) })),
    total: lines.length,
  };
}

// ── Prokop domain tool results (shared by Codex dynamic and Claude MCP) ────

export function memoryResultVisualization(tool: string, result: Record<string, unknown>): AnyVisualization {
  if (typeof result.error === 'string') return { type: 'none', message: preview(result.error) };
  const agent = tool === 'agent_memory';
  if (result.action === 'list') {
    const count = Array.isArray(result.entries) ? result.entries.length : 0;
    const usage = result.usage as { chars?: unknown; limit?: unknown } | undefined;
    const chars = typeof usage?.chars === 'number' ? usage.chars : 0;
    const limit = typeof usage?.limit === 'number' ? usage.limit : 0;
    return { type: 'none', badge: `${count} entr${count === 1 ? 'y' : 'ies'}`
      + (!agent && usage ? ` · ${chars}/${limit} chars` : ''),
    message: `${agent ? 'Agent memory' : 'Memory'} (${result.target ?? 'memory'})` };
  }
  return { type: 'none', message: typeof result.title === 'string' ? preview(result.title)
    : agent ? 'Agent memory updated' : 'Memory updated' };
}

export function sessionSearchResultVisualization(result: Record<string, unknown>): AnyVisualization {
  if (typeof result.error === 'string') return { type: 'none', message: preview(result.error) };
  const results = Array.isArray(result.results) ? result.results : null;
  const sessions = Array.isArray(result.sessions) ? result.sessions : null;
  if (results || sessions) {
    const entries = (results ?? sessions)!;
    const label = results ? 'result' : 'session';
    return { type: 'file-list', badge: `${entries.length} ${label}${entries.length === 1 ? '' : 's'}`,
      singularLabel: label, pluralLabel: `${label}s`,
      ...(results && { title: typeof result.query === 'string' ? preview(result.query)
        : typeof result.title === 'string' ? preview(result.title) : 'Search' }),
      files: entries.slice(0, 20).map(entry => {
        const row = entry as Record<string, unknown>;
        const title = results ? row.sessionTitle ?? row.sessionId : row.title ?? row.id;
        return { path: preview(typeof title === 'string' ? title : '') };
      }), total: entries.length };
  }
  if (Array.isArray(result.messages)) return { type: 'none',
    badge: `${result.messages.length} message${result.messages.length === 1 ? '' : 's'}`,
    message: typeof result.sessionTitle === 'string' ? preview(result.sessionTitle) : 'Session context' };
  return { type: 'none', message: typeof result.title === 'string' ? preview(result.title) : 'Session search completed' };
}

export function agentSkillResultVisualization(result: Record<string, unknown>): AnyVisualization {
  if (typeof result.error === 'string') return { type: 'none', message: preview(result.error) };
  if (result.action === 'list' && Array.isArray(result.skills)) {
    return { type: 'file-list', badge: `${result.skills.length} skill${result.skills.length === 1 ? '' : 's'}`,
      singularLabel: 'skill', pluralLabel: 'skills', title: 'Agent skills',
      files: result.skills.slice(0, 20).map(skill => {
        const entry = skill as Record<string, unknown>;
        return { path: typeof entry.name === 'string' ? preview(entry.name) : '',
          content: typeof entry.description === 'string' ? preview(entry.description) : '' };
      }), total: result.skills.length };
  }
  return { type: 'none', message: typeof result.title === 'string' ? preview(result.title) : 'Agent skill updated' };
}

// ── Claude per-tool visualization at tool-end ──────────────────────────────

function parseJsonOutput(output: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(output) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}

/**
 * Visualization for a completed Claude tool call, keyed on the canonical
 * name. `output` is the tool_result content string (already length-capped
 * upstream). Unknown tools get a plain completion chip.
 */
export function claudeToolVisualization(
  name: string,
  input: Record<string, unknown>,
  output: string,
  failed: boolean,
): AnyVisualization {
  const content = preview(output);
  switch (name) {
    case 'shell': {
      // Claude reports failures via is_error; a trailing "Exit code N" is
      // parsed when present, otherwise failed maps to 1 and success to 0.
      const exit = /Exit code (\d+)/.exec(output)?.[1];
      return { type: 'shell-output', command: typeof input.command === 'string' ? input.command : '',
        stdout: content, exitCode: exit ? Number(exit) : failed ? 1 : 0 };
    }
    case 'edit': {
      const parsed = claudeEditPairs(input);
      if (!parsed) return { type: 'none', message: 'Edit completed' };
      return editDiffVisualization(parsed.filePath, parsed.edits);
    }
    case 'write-file':
      return { type: 'code', path: typeof input.file_path === 'string' ? input.file_path : 'File',
        content: typeof input.content === 'string' ? preview(input.content) : content, created: true };
    case 'read-file':
      return { type: 'code', path: typeof input.file_path === 'string' ? input.file_path : 'File',
        content, created: false };
    case 'glob': return fileListFromLines(output, 'file');
    case 'grep': return fileListFromLines(output, 'match');
    case 'webfetch':
      return { type: 'markdown', content, ...(typeof input.url === 'string' ? { sourceUrl: input.url } : {}) };
    case 'web-search': return { type: 'markdown', content };
    case 'todo': {
      const todos = Array.isArray(input.todos) ? input.todos : [];
      return { type: 'todo-list', items: todos.slice(0, 100).map(todo => {
        const entry = todo as Record<string, unknown>;
        return {
          content: typeof entry.content === 'string' ? entry.content : '',
          status: entry.status === 'in_progress' || entry.status === 'completed' || entry.status === 'cancelled'
            ? entry.status : 'pending',
          priority: entry.priority === 'high' || entry.priority === 'medium' || entry.priority === 'low'
            ? entry.priority : 'medium',
        };
      }) };
    }
    case 'subagent': return { type: 'none', message: 'Subagent task completed' };
    case 'memory': case 'agent_memory': case 'session_search': case 'agent_skill_manage': {
      const result = parseJsonOutput(output);
      if (!result) return { type: 'none', message: preview(output || 'Tool completed') };
      return name === 'memory' || name === 'agent_memory' ? memoryResultVisualization(name, result)
        : name === 'session_search' ? sessionSearchResultVisualization(result)
          : agentSkillResultVisualization(result);
    }
    default:
      return { type: 'none', message: `${name} completed` };
  }
}
