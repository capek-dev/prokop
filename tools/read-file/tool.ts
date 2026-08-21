import type { ToolDefinition, ToolContext, ToolResult } from '@prokopai/sdk';
import type { NoneVisualization } from '@prokopai/sdk';
import { createFilePermissionAsk, SENSITIVE_FILE_PATTERNS } from '@prokopai/sdk';
import { createHash } from 'node:crypto';

const DEFAULT_READ_LIMIT = 2000;
const MAX_LINE_LENGTH = 2000;
const MAX_LINE_SUFFIX = `... (line truncated to ${MAX_LINE_LENGTH} chars)`;
const MAX_BYTES = 50 * 1024;

function computeRevision(content: string | Uint8Array): string {
  const hash = createHash('sha256');
  hash.update(content);
  return `sha256:${hash.digest('hex')}`;
}

interface Input {
  path: string;
  offset?: number;
  limit?: number;
}

export const definition: ToolDefinition = {
  name: 'read-file',
  description: 'Read a file or directory from the filesystem.\n\nUsage:\n- The path parameter should be an absolute path.\n- By default, returns up to 2000 lines from the start of the file.\n- The offset parameter is the line number to start from (1-indexed).\n- To read later sections, use a larger offset.\n\n## Revision metadata\n\nRegular-file results include a `revision` (SHA-256 of the complete file content) plus `totalLines`, `offset`, `linesReturned`, and `truncated`. The revision is computed from the untruncated bytes, including line endings and trailing newline state, so it is identical across paginated reads of an unchanged file. Pass the revision to `edit-range` to prove the file has not changed since it was read. Directory reads do not include a revision.\n\n## Permission Model\n\nThis tool requires explicit permission for:\n- Files outside the workspace\n- Sensitive files (.env, .pem, .key, credentials, etc.)',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The absolute path to the file or directory to read',
      },
      offset: {
        type: 'number',
        description: 'The line number to start reading from (1-indexed)',
      },
      limit: {
        type: 'number',
        description: 'The maximum number of lines to read (defaults to 2000)',
      },
    },
    required: ['path'],
  },
  timeout: 30000,
};

async function isBinaryFile(filePath: string, content: string): Promise<boolean> {
  const ext = '.' + (filePath.split('.').pop()?.toLowerCase() || '');
  const binaryExts = [
    '.zip', '.tar', '.gz', '.exe', '.dll', '.so', '.class', '.jar', '.war',
    '.7z', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp',
    '.bin', '.dat', '.obj', '.o', '.a', '.lib', '.wasm', '.pyc', '.pyo',
  ];
  if (binaryExts.includes(ext)) return true;

  const bytes = new TextEncoder().encode(content.slice(0, 4096));
  let nonPrintableCount = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) return true;
    if (bytes[i] < 9 || (bytes[i] > 13 && bytes[i] < 32)) {
      nonPrintableCount++;
    }
  }
  return bytes.length > 0 && nonPrintableCount / bytes.length > 0.3;
}

function isSensitivePath(path: string): boolean {
  const lower = path.toLowerCase();
  return SENSITIVE_FILE_PATTERNS.some(p => lower.includes(p));
}

export async function execute(input: Input, ctx: ToolContext): Promise<ToolResult> {
  try {
    const resolvedPath = ctx.resolvePath(input.path);

    if (ctx.isBlockedPath(resolvedPath)) {
      return { success: false, error: `Reading from system directories is not allowed: ${input.path}` };
    }

    const tempDir = ctx.env.get('JEAN2_TEMP_DIR') || ctx.env.get('TMPDIR') || '';
    const jean2TempPrefix = tempDir ? `${tempDir.replace(/[/\\]$/, '')}/jean2/` : '';
    const isJean2Temp = jean2TempPrefix && resolvedPath.startsWith(jean2TempPrefix);

    if (!isJean2Temp && ctx.allowedPaths && !ctx.allowedPaths.some(p => resolvedPath.startsWith(p))) {
      const outsideWorkspace = !ctx.isWithinWorkspace(resolvedPath);
      const sensitive = isSensitivePath(resolvedPath);

      // Outside workspace permission ask
      if (outsideWorkspace) {
        const permAsk = createFilePermissionAsk({
          path: input.path,
          operation: 'read',
          risk: 'medium',
          isOutsideWorkspace: true,
        });

        const approved = await ctx.ask(permAsk);
        if (!approved) return { success: false, error: 'USER_REJECTION' };
      }

      // Sensitive file permission ask (separate ask for clarity)
      if (sensitive) {
        const permAsk = createFilePermissionAsk({
          path: input.path,
          operation: 'read',
          risk: 'medium',
          isSensitiveFile: true,
          reason: 'This file may contain credentials or secrets.',
        });

        const approved = await ctx.ask(permAsk);
        if (!approved) return { success: false, error: 'USER_REJECTION' };
      }
    }

    const stat = await ctx.fs.stat(resolvedPath);
    if (!stat) {
      return { success: false, error: `File not found: ${resolvedPath}` };
    }

    if (stat.isDirectory) {
      const entries = await ctx.fs.readDir(resolvedPath);
      const filtered = entries.filter((e) => e.name !== '.' && e.name !== '..');

      const marked = filtered
        .map((e) => (e.isDirectory ? e.name + '/' : e.name))
        .sort((a, b) => a.localeCompare(b));

      const readLimit = input.limit ?? DEFAULT_READ_LIMIT;
      const readOffset = input.offset ?? 1;
      const start = readOffset - 1;
      const sliced = marked.slice(start, start + readLimit);
      const truncated = start + sliced.length < marked.length;

      let content = sliced.join('\n');
      if (truncated) {
        content += `\n\n(Showing ${sliced.length} of ${marked.length} entries. Use 'offset' parameter to read beyond entry ${readOffset + sliced.length})`;
      } else {
        content += `\n\n(${marked.length} entries)`;
      }

      const visualization: NoneVisualization = {
        type: 'none',
        message: `Read: ${resolvedPath}/`,
      };

      return { success: true, result: { content }, visualization };
    }

    const content = await ctx.fs.readFile(resolvedPath, 'utf-8');
    if (await isBinaryFile(resolvedPath, content)) {
      return { success: false, error: `Cannot read binary file: ${resolvedPath}` };
    }

    const lines = content.split('\n');

    const readLimit = input.limit ?? DEFAULT_READ_LIMIT;
    const readOffset = input.offset ?? 1;
    const start = readOffset - 1;

    if (readOffset < 1) {
      return { success: false, error: 'offset must be greater than or equal to 1' };
    }

    const outputLines: string[] = [];
    let bytes = 0;

    for (let i = start; i < lines.length && outputLines.length < readLimit; i++) {
      let line = lines[i];

      if (line.length > MAX_LINE_LENGTH) {
        line = line.substring(0, MAX_LINE_LENGTH) + MAX_LINE_SUFFIX;
      }

      const lineWithNumber = `${i + 1}: ${line}`;
      const lineSize = new TextEncoder().encode(lineWithNumber).length + (outputLines.length > 0 ? 1 : 0);

      if (bytes + lineSize > MAX_BYTES) {
        break;
      }

      outputLines.push(lineWithNumber);
      bytes += lineSize;
    }

    const content2 = outputLines.join('\n');
    const totalLines = lines.length;
    const lastReadLine = start + outputLines.length;
    const nextOffset = lastReadLine + 1;
    const truncated = lastReadLine < totalLines;

    let finalContent = content2;
    if (truncated) {
      finalContent += `\n\n(Showing lines ${readOffset}-${lastReadLine} of ${totalLines}. Use offset=${nextOffset} to continue.)`;
    } else {
      finalContent += `\n\n(End of file - total ${totalLines} lines)`;
    }

    const visualization: NoneVisualization = {
      type: 'none',
      message: `Read: ${resolvedPath}`,
    };

    return {
      success: true,
      result: {
        content: finalContent,
        revision: computeRevision(content),
        totalLines,
        offset: readOffset,
        linesReturned: outputLines.length,
        truncated,
      },
      visualization,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
