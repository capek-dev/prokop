import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AskApi, ToolResult } from '@jean2/sdk';
import { executeTool } from '../src/tools/executor';
import { getStandardTool, STANDARD_TOOL_NAMES } from '../src/tools/standard-tools';
import { createWorkspaceCapability } from '../src/tools/workspace-capability';
import { createInMemoryStorageBundle, withStorage } from '@capekai/core/storage';

const roots: string[] = [];

async function createRoot(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'capek-standard-tools-'));
  roots.push(path);
  return path;
}

afterEach(async () => {
  for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true });
});

async function runTool(
  root: string,
  name: string,
  args: Record<string, unknown>,
  ask: AskApi = (async () => true) as unknown as AskApi,
  abortSignal?: AbortSignal,
): Promise<ToolResult> {
  const loaded = getStandardTool(name);
  if (!loaded) throw new Error(`Missing standard tool: ${name}`);
  return executeTool({
    tool: loaded,
    args,
    workspace: createWorkspaceCapability({
      root,
      allowedRoots: [],
      tempDir: join(root, '.tmp'),
    }),
    sessionId: 'standard-tools-test',
    toolCallId: `${name}-call`,
    createAskApi: () => ask,
    abortSignal,
  });
}

describe('bundled standard tools', () => {
  test('contains the exact Phase 9 set with scoped output retrieval', () => {
    expect(STANDARD_TOOL_NAMES).toEqual([
      'read-file',
      'write-file',
      'edit',
      'edit-range',
      'apply-patch',
      'ls',
      'glob',
      'grep',
      'shell',
      'question',
      'retrieve-tool-output',
    ]);
    expect(getStandardTool('retrieve-exact-tool-output')).toBeNull();
  });

  test('executes every bundled tool without a repository tools path', async () => {
    const root = await createRoot();
    const source = join(root, 'source.txt');

    expect((await runTool(root, 'write-file', { path: source, content: 'alpha\nbeta\n' })).success).toBe(true);
    expect((await runTool(root, 'edit', {
      path: source,
      oldString: 'beta',
      newString: 'needle',
    })).success).toBe(true);

    const read = await runTool(root, 'read-file', { path: source });
    expect(read.success).toBe(true);
    const revision = (read.result as { revision: string }).revision;
    expect((await runTool(root, 'edit-range', {
      path: source,
      revision,
      edits: [{ startLine: 1, endLine: 1, newString: 'first' }],
    })).success).toBe(true);

    expect((await runTool(root, 'apply-patch', {
      patch: '*** Begin Patch\n*** Add File: added.txt\n+patched\n*** End Patch',
    })).success).toBe(true);
    expect(await readFile(join(root, 'added.txt'), 'utf-8')).toBe('patched');

    const listed = await runTool(root, 'ls', { path: root });
    expect(listed.success).toBe(true);
    expect((listed.result as { files: string[] }).files).toContain('source.txt');

    const globbed = await runTool(root, 'glob', { pattern: '*.txt', path: root });
    expect(globbed.success).toBe(true);
    expect((globbed.result as { files: string[] }).files).toContain('added.txt');

    const searched = await runTool(root, 'grep', { pattern: 'needle', path: root });
    expect(searched.success).toBe(true);
    expect((searched.result as { matches: unknown[] }).matches).toHaveLength(1);

    const shelled = await runTool(root, 'shell', { command: 'printf capek', cwd: root });
    expect(shelled.success).toBe(true);
    expect((shelled.result as { stdout: string }).stdout).toBe('capek');

    const questioned = await runTool(
      root,
      'question',
      {
        title: 'Choose',
        questions: [{ type: 'confirm', question: 'Continue?' }],
      },
      (async () => ({ type: 'form', answers: [{ answer: true }] })) as unknown as AskApi,
    );
    expect(questioned.success).toBe(true);
  });

  test('returns non-zero shell exits as actionable failures with output', async () => {
    const root = await createRoot();
    const result = await runTool(root, 'shell', { command: 'printf failed >&2; exit 3', cwd: root });

    expect(result).toEqual({
      success: false,
      error: 'Shell command failed with exit code 3: failed',
      result: { stdout: '', stderr: 'failed', exitCode: 3 },
    });
  });

  test('retrieves bounded output in the implicit session scope without permission', async () => {
    const root = await createRoot();
    const storage = createInMemoryStorageBundle();
    const artifact = storage.toolOutputArtifacts.create({
      sessionId: 'standard-tools-test',
      toolCallId: 'large-call',
      toolName: 'large-tool',
      content: 'x'.repeat(30_000),
      format: 'text',
    });

    await withStorage(storage, async () => {
      const page = await runTool(
        root,
        'retrieve-tool-output',
        { artifactId: artifact.id, offset: 10, limit: 25_000 },
        (async () => {
          throw new Error('Retrieval must not request permission');
        }) as unknown as AskApi,
      );
      expect(page.success).toBe(true);
      expect(page.result).toMatchObject({
        artifactId: artifact.id,
        offset: 10,
        limit: 20_000,
        totalChars: 30_000,
        nextOffset: 20_010,
        complete: false,
      });
    });

    const otherSessionStorage = createInMemoryStorageBundle();
    await withStorage(otherSessionStorage, async () => {
      const missing = await runTool(root, 'retrieve-tool-output', { artifactId: artifact.id });
      expect(missing).toEqual({ success: false, error: 'Tool output artifact not found' });
    });
  });

  test('defaults grep to the workspace and reads single-file gitignore from its parent', async () => {
    const root = await createRoot();
    await writeFile(join(root, 'visible.txt'), 'needle\n');

    const workspaceResult = await runTool(root, 'grep', { pattern: 'needle' });
    expect((workspaceResult.result as { matches: Array<{ file: string; line: number; content: string }> }).matches).toEqual([
      { file: 'visible.txt', line: 1, content: 'needle' },
    ]);

    await writeFile(join(root, '.gitignore'), 'visible.txt\n');
    const fileResult = await runTool(root, 'grep', { pattern: 'needle', path: join(root, 'visible.txt') });
    expect((fileResult.result as { matches: unknown[] }).matches).toEqual([]);
  });

  test('skips hidden directories and caps ls traversal at 100 files', async () => {
    const root = await createRoot();
    await mkdir(join(root, '.hidden'), { recursive: true });
    await writeFile(join(root, '.hidden', 'secret.txt'), 'hidden');
    await Promise.all(Array.from({ length: 110 }, (_, index) => writeFile(join(root, `file-${index}.txt`), 'x')));

    const result = await runTool(root, 'ls', { path: root, showHidden: false });
    const output = result.result as { files: string[]; truncated: boolean };
    expect(output.files).toHaveLength(100);
    expect(output.files.some((file) => file.startsWith('.hidden/'))).toBe(false);
    expect(output.truncated).toBe(true);
  });

  test('kills a running shell child when aborted', async () => {
    const root = await createRoot();
    const controller = new AbortController();
    const startedAt = performance.now();
    const running = runTool(
      root,
      'shell',
      { command: 'sleep 5', cwd: root },
      undefined,
      controller.signal,
    );
    await Bun.sleep(30);
    controller.abort();

    expect(await running).toEqual({ success: false, error: 'Tool execution interrupted' });
    expect(performance.now() - startedAt).toBeLessThan(1000);
  });

  test('kills a running shell process group when aborted', async () => {
    if (process.platform === 'win32') return;
    const root = await createRoot();
    const controller = new AbortController();
    const startedAt = performance.now();
    const running = runTool(
      root,
      'shell',
      { command: 'sleep 5 | cat', cwd: root },
      undefined,
      controller.signal,
    );
    await Bun.sleep(30);
    controller.abort();

    expect(await running).toEqual({ success: false, error: 'Tool execution interrupted' });
    expect(performance.now() - startedAt).toBeLessThan(1000);
  });

  test('gates dangerous shell commands through permission handling', async () => {
    const root = await createRoot();
    const asked: unknown[] = [];
    const result = await runTool(
      root,
      'shell',
      { command: 'chmod 777 source.txt', cwd: root },
      (async (request: unknown) => {
        asked.push(request);
        return false;
      }) as unknown as AskApi,
    );

    expect(result).toEqual({ success: false, error: 'USER_REJECTION' });
    expect(asked).toHaveLength(1);
  });
});
