import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { definition, execute } from './tool';
import { createMockContext, VirtualFS, WORKSPACE } from '../test-utils';

let vfs: VirtualFS;
let ctx: ReturnType<typeof createMockContext>;

beforeEach(() => {
  vfs = new VirtualFS();
  ctx = createMockContext(vfs);
});

// ══════════════════════════════════════════════════════════════════
// Tool Definition
// ══════════════════════════════════════════════════════════════════

describe('glob tool definition', () => {
  test('has correct name', () => {
    expect(definition.name).toBe('glob');
  });

  test('has required pattern input', () => {
    const schema = definition.inputSchema as { properties: Record<string, unknown>; required: string[] };
    expect(schema.required).toContain('pattern');
  });

  test('has optional ignore input', () => {
    const schema = definition.inputSchema as { properties: Record<string, unknown> };
    expect(schema.properties).toHaveProperty('ignore');
  });
});

// ══════════════════════════════════════════════════════════════════
// Pattern Matching — Basic
// ══════════════════════════════════════════════════════════════════

describe('glob: basic pattern matching', () => {
  test('finds files with **/*.ts pattern', async () => {
    vfs.writeFile(`${WORKSPACE}/src/index.ts`, '');
    vfs.writeFile(`${WORKSPACE}/src/app.ts`, '');
    vfs.writeFile(`${WORKSPACE}/src/style.css`, '');
    vfs.addDir(`${WORKSPACE}/src`);

    const result = await execute({ pattern: '**/*.ts' }, ctx);
    expect(result.success).toBe(true);
    const files = (result.result as { files: string[] }).files;
    expect(files.length).toBe(2);
  });

  test('finds files with specific filename pattern', async () => {
    vfs.writeFile(`${WORKSPACE}/package.json`, '{}');
    vfs.writeFile(`${WORKSPACE}/tsconfig.json`, '{}');

    const result = await execute({ pattern: 'package.json' }, ctx);
    expect(result.success).toBe(true);
    const files = (result.result as { files: string[] }).files;
    expect(files).toContain('package.json');
  });

  test('returns empty array when no files match', async () => {
    vfs.writeFile(`${WORKSPACE}/readme.md`, 'hello');

    const result = await execute({ pattern: '*.xyz' }, ctx);
    expect(result.success).toBe(true);
    const files = (result.result as { files: string[] }).files;
    expect(files.length).toBe(0);
  });

  test('non-wildcard pattern checks if exact file exists', async () => {
    vfs.writeFile(`${WORKSPACE}/exact-file.txt`, 'content');

    const result = await execute({ pattern: 'exact-file.txt' }, ctx);
    expect(result.success).toBe(true);
    const files = (result.result as { files: string[] }).files;
    expect(files).toContain('exact-file.txt');
  });

  test('non-wildcard pattern returns empty for non-existent file', async () => {
    const result = await execute({ pattern: 'does-not-exist.txt' }, ctx);
    expect(result.success).toBe(true);
    const files = (result.result as { files: string[] }).files;
    expect(files.length).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════
// Pattern Matching — Brace Expansion
// ══════════════════════════════════════════════════════════════════

describe('glob: brace expansion', () => {
  test('matches multiple extensions with *.{js,ts}', async () => {
    vfs.writeFile(`${WORKSPACE}/app.js`, '');
    vfs.writeFile(`${WORKSPACE}/app.ts`, '');
    vfs.writeFile(`${WORKSPACE}/app.css`, '');

    const result = await execute({ pattern: '*.{js,ts}' }, ctx);
    expect(result.success).toBe(true);
    const files = (result.result as { files: string[] }).files;
    expect(files.sort()).toEqual(['app.js', 'app.ts']);
  });

  test('matches multiple directory names with {src,lib}/**', async () => {
    vfs.writeFile(`${WORKSPACE}/src/a.ts`, '');
    vfs.writeFile(`${WORKSPACE}/lib/b.ts`, '');
    vfs.writeFile(`${WORKSPACE}/test/c.ts`, '');
    vfs.addDir(`${WORKSPACE}/src`);
    vfs.addDir(`${WORKSPACE}/lib`);
    vfs.addDir(`${WORKSPACE}/test`);

    const result = await execute({ pattern: '{src,lib}/**' }, ctx);
    expect(result.success).toBe(true);
    const files = (result.result as { files: string[] }).files;
    expect(files.sort()).toEqual(['lib/b.ts', 'src/a.ts']);
  });

  test('brace expansion with nested directories', async () => {
    vfs.writeFile(`${WORKSPACE}/src/components/Button.tsx`, '');
    vfs.writeFile(`${WORKSPACE}/src/components/Button.test.tsx`, '');
    vfs.addDir(`${WORKSPACE}/src/components`);

    const result = await execute({ pattern: '**/*.{ts,tsx}' }, ctx);
    expect(result.success).toBe(true);
    const files = (result.result as { files: string[] }).files;
    expect(files.length).toBe(2);
  });
});

// ══════════════════════════════════════════════════════════════════
// Pattern Matching — Character Classes
// ══════════════════════════════════════════════════════════════════

describe('glob: character classes', () => {
  test('matches character range [a-m]*.ts', async () => {
    vfs.writeFile(`${WORKSPACE}/app.ts`, '');
    vfs.writeFile(`${WORKSPACE}/map.ts`, '');
    vfs.writeFile(`${WORKSPACE}/zip.ts`, '');

    const result = await execute({ pattern: '[a-m]*.ts' }, ctx);
    expect(result.success).toBe(true);
    const files = (result.result as { files: string[] }).files;
    expect(files.sort()).toEqual(['app.ts', 'map.ts']);
  });

  test('matches negated character class [^.]*', async () => {
    vfs.writeFile(`${WORKSPACE}/visible.ts`, '');
    vfs.writeFile(`${WORKSPACE}/.hidden.ts`, '');

    const result = await execute({ pattern: '[^.]*' }, ctx);
    expect(result.success).toBe(true);
    const files = (result.result as { files: string[] }).files;
    expect(files).toContain('visible.ts');
    expect(files).not.toContain('.hidden.ts');
  });

  test('matches specific characters [abc]*.ts', async () => {
    vfs.writeFile(`${WORKSPACE}/app.ts`, '');
    vfs.writeFile(`${WORKSPACE}/bmp.ts`, '');
    vfs.writeFile(`${WORKSPACE}/cat.ts`, '');
    vfs.writeFile(`${WORKSPACE}/dog.ts`, '');

    const result = await execute({ pattern: '[abc]*.ts' }, ctx);
    expect(result.success).toBe(true);
    const files = (result.result as { files: string[] }).files;
    expect(files.sort()).toEqual(['app.ts', 'bmp.ts', 'cat.ts']);
  });
});

// ══════════════════════════════════════════════════════════════════
// Pattern Matching — Extglob
// ══════════════════════════════════════════════════════════════════

describe('glob: extglob patterns', () => {
  test('negation !(pattern) excludes matching files', async () => {
    vfs.writeFile(`${WORKSPACE}/README.md`, '');
    vfs.writeFile(`${WORKSPACE}/CONTRIBUTING.md`, '');
    vfs.writeFile(`${WORKSPACE}/app.ts`, '');

    const result = await execute({ pattern: '!(README).md' }, ctx);
    expect(result.success).toBe(true);
    const files = (result.result as { files: string[] }).files;
    expect(files).toContain('CONTRIBUTING.md');
    expect(files).not.toContain('README.md');
  });

  test('one-or-more +(pattern) matches repeated pattern', async () => {
    vfs.writeFile(`${WORKSPACE}/a.ts`, '');
    vfs.writeFile(`${WORKSPACE}/ab.ts`, '');
    vfs.writeFile(`${WORKSPACE}/abc.ts`, '');
    vfs.writeFile(`${WORKSPACE}/ac.ts`, '');

    const result = await execute({ pattern: '+(a|b).ts' }, ctx);
    expect(result.success).toBe(true);
    const files = (result.result as { files: string[] }).files;
    expect(files.sort()).toEqual(['a.ts', 'ab.ts']);
  });
});

// ══════════════════════════════════════════════════════════════════
// Ignore Patterns
// ══════════════════════════════════════════════════════════════════

describe('glob: ignore patterns', () => {
  test('ignores files matching ignore pattern', async () => {
    vfs.writeFile(`${WORKSPACE}/app.ts`, '');
    vfs.writeFile(`${WORKSPACE}/app.test.ts`, '');
    vfs.writeFile(`${WORKSPACE}/util.test.ts`, '');

    const result = await execute({ pattern: '*.ts', ignore: ['*.test.ts'] }, ctx);
    expect(result.success).toBe(true);
    const files = (result.result as { files: string[] }).files;
    expect(files).toEqual(['app.ts']);
  });

  test('ignores directories with ** pattern', async () => {
    vfs.writeFile(`${WORKSPACE}/src/a.ts`, '');
    vfs.writeFile(`${WORKSPACE}/src/b.ts`, '');
    vfs.writeFile(`${WORKSPACE}/fixtures/c.ts`, '');
    vfs.writeFile(`${WORKSPACE}/fixtures/d.ts`, '');
    vfs.addDir(`${WORKSPACE}/src`);
    vfs.addDir(`${WORKSPACE}/fixtures`);

    const result = await execute({ pattern: '**/*.ts', ignore: ['fixtures/**'] }, ctx);
    expect(result.success).toBe(true);
    const files = (result.result as { files: string[] }).files;
    expect(files.sort()).toEqual(['src/a.ts', 'src/b.ts']);
  });

  test('multiple ignore patterns', async () => {
    vfs.writeFile(`${WORKSPACE}/app.ts`, '');
    vfs.writeFile(`${WORKSPACE}/app.test.ts`, '');
    vfs.writeFile(`${WORKSPACE}/app.spec.ts`, '');
    vfs.writeFile(`${WORKSPACE}/app.stories.ts`, '');

    const result = await execute({ pattern: '*.ts', ignore: ['*.test.ts', '*.spec.ts'] }, ctx);
    expect(result.success).toBe(true);
    const files = (result.result as { files: string[] }).files;
    expect(files.sort()).toEqual(['app.stories.ts', 'app.ts']);
  });

  test('empty ignore array has no effect', async () => {
    vfs.writeFile(`${WORKSPACE}/app.ts`, '');
    vfs.writeFile(`${WORKSPACE}/app.test.ts`, '');

    const result = await execute({ pattern: '*.ts', ignore: [] }, ctx);
    expect(result.success).toBe(true);
    const files = (result.result as { files: string[] }).files;
    expect(files.length).toBe(2);
  });
});

// ══════════════════════════════════════════════════════════════════
// Sorting
// ══════════════════════════════════════════════════════════════════

describe('glob: sorting', () => {
  test('results are returned (order determined by mtime)', async () => {
    vfs.writeFile(`${WORKSPACE}/old.ts`, '');
    vfs.writeFile(`${WORKSPACE}/new.ts`, '');
    vfs.writeFile(`${WORKSPACE}/middle.ts`, '');

    const result = await execute({ pattern: '*.ts' }, ctx);
    expect(result.success).toBe(true);
    const files = (result.result as { files: string[] }).files;
    expect(files.length).toBe(3);
  });
});

// ══════════════════════════════════════════════════════════════════
// Permissions
// ══════════════════════════════════════════════════════════════════

describe('glob: permissions', () => {
  test('blocked path returns error', async () => {
    const result = await execute({ pattern: '*.ts', path: '/etc/' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('system directories');
  });

  test('outside workspace requires permission', async () => {
    vfs.addDir('/tmp/external');
    const _result = await execute({ pattern: '*.ts', path: '/tmp/external' }, ctx);
    expect(ctx.ask).toHaveBeenCalled();
  });

  test('outside workspace rejected returns USER_REJECTION', async () => {
    const rejectCtx = createMockContext(vfs, {
      ask: mock(async () => false) as unknown as typeof ctx.ask,
    });
    vfs.addDir('/tmp/external');
    const result = await execute({ pattern: '*.ts', path: '/tmp/external' }, rejectCtx);
    expect(result.success).toBe(false);
    expect(result.error).toBe('USER_REJECTION');
  });

  test('workspace does not require permission', async () => {
    vfs.writeFile(`${WORKSPACE}/test.ts`, '');
    const result = await execute({ pattern: '*.ts' }, ctx);
    expect(result.success).toBe(true);
    expect(ctx.ask).not.toHaveBeenCalled();
  });
});
