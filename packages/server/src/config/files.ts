import { writeFile, rename, readFile, unlink, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { existsSync } from 'fs';
import { randomUUID } from 'crypto';

export async function atomicWriteFile(filePath: string, content: string): Promise<void> {
  const dir = dirname(filePath);

  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }

  const tempFilePath = join(dir, `.tmp-${randomUUID()}`);

  try {
    await writeFile(tempFilePath, content, 'utf-8');
    await rename(tempFilePath, filePath);
  } catch (err) {
    try {
      await unlink(tempFilePath);
    } catch {
      // Ignore cleanup errors
    }
    throw err;
  }
}

export async function readFileSafe(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

export function fileExistsSync(filePath: string): boolean {
  return existsSync(filePath);
}

export async function ensureDir(dirPath: string): Promise<void> {
  if (!existsSync(dirPath)) {
    await mkdir(dirPath, { recursive: true });
  }
}
