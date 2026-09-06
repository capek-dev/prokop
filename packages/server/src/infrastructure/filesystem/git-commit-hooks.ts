import { constants } from 'node:fs';
import { access, mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

function quote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * Preserve repository hooks, then validate the final proposed index in commit-msg
 * (the last pre-commit hook). A formatter running `git add -A` must not silently
 * include unchecked files. Git for Windows also executes shebang hooks through sh.
 */
export async function createSelectedCommitHooks(directory: string, original: string, repoPaths: string[]): Promise<string> {
  const hooks = join(directory, 'hooks');
  await mkdir(hooks);
  const excludes = repoPaths.map((path) => quote(`:(top,literal,exclude)${path}`)).join(' ');
  const originals = await readdir(original).catch((error: unknown) => {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return [];
    throw error;
  });
  for (const name of new Set(['commit-msg', ...originals])) {
    const originalPath = join(original, name);
    if (name !== 'commit-msg' && !await access(originalPath, constants.X_OK).then(() => true, () => false)) continue;
    const source = quote(originalPath);
    const script = [
      '#!/bin/sh',
      `if test -x ${source}; then`,
      `  ${source} "$@" || exit $?`,
      'fi',
    ];
    if (name === 'commit-msg') {
      script.push(
        `git --no-literal-pathspecs diff --cached --quiet -- . ${excludes} || {`,
        '  echo "Commit refused: a hook included files outside the selection." >&2',
        '  exit 1',
        '}',
      );
    }
    await writeFile(join(hooks, name), `${script.join('\n')}\n`, { mode: 0o700 });
  }
  return hooks;
}
