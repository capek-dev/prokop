import { readFileSync } from 'fs';
import { join } from 'path';

declare const PROKOPAI_VERSION: string | undefined;
declare const JEAN2_VERSION: string | undefined;

function getVersion(): string {
  // PROKOPAI_VERSION is the canonical compile-time define (build:bin).
  // JEAN2_VERSION is accepted during the rename transition in case an older
  // build pipeline still passes it.
  if (typeof PROKOPAI_VERSION !== 'undefined') {
    return PROKOPAI_VERSION;
  }
  if (typeof JEAN2_VERSION !== 'undefined') {
    return JEAN2_VERSION;
  }
  try {
    const versionPath = join(import.meta.dirname, '..', 'VERSION');
    return readFileSync(versionPath, 'utf-8').trim();
  } catch {
    return '0.0.0-dev';
  }
}

export const VERSION = getVersion();
