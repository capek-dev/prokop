const MIN_VERSION = 'Claude CLI 2.1.259 or newer is required on this host';

export function claudeCliVersion(): string {
  const result = Bun.spawnSync(['claude', '--version'], { stdout: 'pipe', stderr: 'ignore' });
  if (result.exitCode !== 0) throw new Error(MIN_VERSION);
  const version = result.stdout.toString().trim();
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match || Number(match[1]) < 2 || Number(match[1]) === 2 && Number(match[2]) < 1
    || Number(match[1]) === 2 && Number(match[2]) === 1 && Number(match[3]) < 259) {
    throw new Error(MIN_VERSION);
  }
  return version;
}

export function claudeCliAvailable(): boolean {
  try { claudeCliVersion(); return true; } catch { return false; }
}
