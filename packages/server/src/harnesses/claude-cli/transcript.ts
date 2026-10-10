import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';

const NATIVE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The installed CLI's own JSONL transcript for a native session, or null when
 * it is missing or resolves outside the project folder for `root`.
 */
export function claudeTranscriptPath(root: string, nativeId: string): string | null {
  if (!NATIVE_ID.test(nativeId)) return null;
  const config = resolve(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'));
  const expectedDir = join(config, 'projects', root.replace(/[^a-zA-Z0-9]/g, '-'));
  try {
    const path = realpathSync(join(expectedDir, `${nativeId}.jsonl`));
    return path.startsWith(realpathSync(expectedDir) + sep) ? path : null;
  } catch { return null; }
}
