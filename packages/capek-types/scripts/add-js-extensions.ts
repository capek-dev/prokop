import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';

async function walkDir(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkDir(fullPath));
    } else if (entry.isFile() && fullPath.endsWith('.js')) {
      files.push(fullPath);
    }
  }
  return files;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

const IMPORT_RE = /((?:from\s+['"])|(?:export\s+\*\s+from\s+['"]))(\.{1,2}\/[^'"]+)(['"])/g;

async function addJsExtensions(distDir: string): Promise<void> {
  const jsFiles = await walkDir(distDir);
  let patched = 0;

  for (const file of jsFiles) {
    const content = await readFile(file, 'utf-8');
    const fileDir = dirname(file);

    const matches = [...content.matchAll(IMPORT_RE)];
    if (matches.length === 0) continue;

    let updated = content;
    for (let i = matches.length - 1; i >= 0; i--) {
      const match = matches[i];
      const [fullMatch, prefix, specifier, suffix] = match;
      if (specifier.endsWith('.js')) continue;

      const absoluteSpecifier = join(fileDir, specifier);
      let replacement: string;

      if (await isDirectory(absoluteSpecifier)) {
        replacement = `${prefix}${specifier}/index.js${suffix}`;
      } else {
        replacement = `${prefix}${specifier}.js${suffix}`;
      }

      if (replacement !== fullMatch) {
        updated = updated.slice(0, match.index!) + replacement + updated.slice(match.index! + fullMatch.length);
      }
    }

    if (updated !== content) {
      await writeFile(file, updated, 'utf-8');
      patched++;
    }
  }

  console.log(`Patched ${patched} files with .js extensions`);
}

const distDir = join(new URL('.', import.meta.url).pathname, '..', 'dist');
await addJsExtensions(distDir);
