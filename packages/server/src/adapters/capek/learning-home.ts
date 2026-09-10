import { createHash } from 'node:crypto';
import { lstat, opendir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import type { ToolDefinition, ToolResult } from '@capekai/tool';
import type { KnowledgeFilePort } from '@/application/learning/knowledge-journal';
import { isLearningHomePath } from '@/infrastructure/filesystem/learning-home-policy';

export const learningHomeDefinition: ToolDefinition = {
  name: 'home_files',
  description: 'Maintain text knowledge anywhere in your own home. List/search discover files; read returns content and revision. Write or delete requires the revision from read (null for a new file). Paths are home-relative. No shell, sensitive paths, hidden directories, symlinks, binary files or recursive deletion. Keep snippets as reference material, never execute them.',
  inputSchema: { type: 'object', properties: {
    action: { type: 'string', enum: ['list', 'search', 'read', 'write', 'delete'] },
    path: { type: 'string' }, query: { type: 'string' }, content: { type: 'string' },
    revision: { type: ['string', 'null'] },
  }, required: ['action'], additionalProperties: false },
  timeout: 30000,
};
const schema = z.object({ action: z.enum(['list', 'search', 'read', 'write', 'delete']),
  path: z.string().max(1024).optional(), query: z.string().min(1).max(500).optional(),
  content: z.string().max(1_048_576).optional(), revision: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(),
}).strict();
const revision = (text: string | null) => text === null ? null : createHash('sha256').update(text).digest('hex');

export function createLearningHomeTool(deps: {
  root: string;
  files: KnowledgeFilePort;
  authorize(): Promise<void>;
  apply(path: string, before: string | null, after: string | null): Promise<string>;
}): (input: unknown) => Promise<ToolResult> {
  async function directory(path: string): Promise<void> {
    const parent = dirname(path);
    if (parent !== path) await directory(parent);
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Unsafe home directory');
  }
  async function discover(prefix = ''): Promise<{ paths: string[]; truncated: boolean }> {
    const paths: string[] = [];
    if (prefix && !isLearningHomePath(prefix)) throw new Error('Invalid or protected home path');
    const queue = [prefix];
    let visited = 0;
    while (queue.length && visited < 2000 && paths.length < 200) {
      await deps.authorize();
      const relative = queue.shift()!;
      const absolute = join(resolve(deps.root), relative);
      await directory(absolute);
      const entries = await opendir(absolute);
      for await (const entry of entries) {
        if (++visited > 2000 || paths.length >= 200) return { paths, truncated: true };
        const path = relative ? `${relative}/${entry.name}` : entry.name;
        if (!isLearningHomePath(path) || entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) queue.push(path);
        else if (entry.isFile()) paths.push(path);
      }
    }
    return { paths, truncated: queue.length > 0 };
  }
  return async input => {
    try {
      await deps.authorize();
      const args = schema.parse(input);
      if (args.action === 'list' || args.action === 'search') {
        if (args.action === 'search' && !args.query) throw new Error('Search query required');
        const found = await discover(args.path);
        await deps.authorize();
        if (args.action === 'list') return { success: true, result: found };
        const matches: Array<{ path: string; snippet: string }> = [];
        let bytes = 0;
        for (const path of found.paths) {
          await deps.authorize();
          let text: string | null;
          try { text = await deps.files.read(`home/${path}`); } catch { continue; }
          await deps.authorize();
          if (text === null) continue;
          bytes += Buffer.byteLength(text);
          if (bytes > 4_194_304) return { success: true, result: { matches, truncated: true } };
          const index = text.toLowerCase().indexOf(args.query!.toLowerCase());
          if (index >= 0) matches.push({ path, snippet: text.slice(Math.max(0, index - 100), index + 400) });
          if (matches.length === 25) return { success: true, result: { matches, truncated: true } };
        }
        await deps.authorize();
        return { success: true, result: { matches, truncated: found.truncated } };
      }
      if (!args.path || !isLearningHomePath(args.path)) throw new Error('Invalid or protected home path');
      const path = `home/${args.path}`;
      const before = await deps.files.read(path);
      await deps.authorize();
      if (args.action === 'read') return { success: true, result: { content: before, revision: revision(before) } };
      if (args.revision === undefined || args.revision !== revision(before)) throw new Error('Read the current file first; revision mismatch');
      if (args.action === 'write' && args.content === undefined) throw new Error('Content required');
      const result = await deps.apply(path, before, args.action === 'delete' ? null : args.content!);
      return { success: result === 'applied' || result === 'unchanged', result };
    } catch (error: unknown) {
      return { success: false, error: error instanceof Error ? error.message : 'Home operation failed' };
    }
  };
}
