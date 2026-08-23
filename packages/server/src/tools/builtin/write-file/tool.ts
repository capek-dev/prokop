import type { ToolDefinition, ToolContext, ToolResult } from '@prokopai/sdk';
import type { CodeVisualization } from '@prokopai/sdk';
import { createFilePermissionAsk, SENSITIVE_FILE_PATTERNS } from '@prokopai/sdk';

interface Input {
  path: string;
  content: string;
}

export const definition: ToolDefinition = {
  name: 'write-file',
  description: 'Write content to a file, creating it if it doesn\'t exist or overwriting if it does.\n\nIMPORTANT: Always prefer using the edit tool to modify existing files.\n\n## Permission Model\n\nThis tool requires explicit permission for:\n- Files outside the workspace\n- Sensitive files (.env, .pem, .key, credentials, etc.)',
  display: { summary: '{path}' },
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the file (absolute or relative)',
      },
      content: {
        type: 'string',
        description: 'The content to write to the file',
      },
    },
    required: ['path', 'content'],
  },
  timeout: 30000,
};

function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  const langMap: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    json: 'json', md: 'markdown', css: 'css', html: 'html', py: 'python',
    go: 'go', rs: 'rust', sh: 'bash', yaml: 'yaml', yml: 'yaml',
  };
  return langMap[ext || ''] || ext || 'text';
}

function isSensitivePath(path: string): boolean {
  const lower = path.toLowerCase();
  return SENSITIVE_FILE_PATTERNS.some(p => lower.includes(p));
}

export async function execute(input: Input, ctx: ToolContext): Promise<ToolResult> {
  try {
    const resolvedPath = ctx.resolvePath(input.path);

    if (ctx.isBlockedPath(resolvedPath)) {
      return { success: false, error: `Writing to system directories is not allowed: ${input.path}` };
    }

    // Permission check for outside workspace and sensitive files
    const outsideWorkspace = !ctx.isWithinWorkspace(resolvedPath);
    const sensitive = isSensitivePath(resolvedPath);

    // Outside workspace permission ask
    if (outsideWorkspace) {
      const permAsk = createFilePermissionAsk({
        path: input.path,
        operation: 'write',
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
        operation: 'write',
        risk: 'medium',
        isSensitiveFile: true,
        reason: 'This file may contain credentials or secrets.',
      });

      const approved = await ctx.ask(permAsk);
      if (!approved) return { success: false, error: 'USER_REJECTION' };
    }

    const existed = await ctx.fs.exists(resolvedPath);

    await ctx.fs.writeFile(resolvedPath, input.content);

    const lineCount = input.content.split('\n').length;

    const visualization: CodeVisualization = {
      type: 'code',
      path: resolvedPath,
      content: input.content,
      language: detectLanguage(resolvedPath),
      created: !existed,
      lineCount,
    };

    return {
      success: true,
      result: { path: resolvedPath, bytes: input.content.length },
      visualization,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
