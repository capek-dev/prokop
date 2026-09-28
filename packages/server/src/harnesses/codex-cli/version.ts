const MINIMUM_CODEX_VERSION = 'Codex CLI 0.156.0 or newer is required on the host';

export function validateCodexCliVersion(version: string): string {
  const match = /^codex-cli (\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(MINIMUM_CODEX_VERSION);
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (![major, minor, patch].every(Number.isSafeInteger)
    || major < 0 || (major === 0 && minor < 156)) {
    throw new Error(MINIMUM_CODEX_VERSION);
  }
  return version;
}

export function codexCliVersion(): string {
  const result = Bun.spawnSync(['codex', '--version'], { stdout: 'pipe', stderr: 'ignore' });
  if (result.exitCode !== 0) throw new Error(MINIMUM_CODEX_VERSION);
  return validateCodexCliVersion(result.stdout.toString().trim());
}
